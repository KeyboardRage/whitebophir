const app = require("http").createServer(handler),
  sockets = require("./sockets.js"),
  {log, monitorFunction} = require("./log.js"),
  path = require("path"),
  fs = require("fs"),
  crypto = require("crypto"),
  serveStatic = require("serve-static"),
  createSVG = require("./createSVG.js"),
  templating = require("./templating.js"),
  config = require("./configuration.js"),
  polyfillLibrary = require("polyfill-library"),
  check_output_directory = require("./check_output_directory.js"),
  jsonwebtoken = require("jsonwebtoken");

const MIN_NODE_VERSION = 10.0;

if (parseFloat(process.versions.node) < MIN_NODE_VERSION) {
  console.warn(
    "!!! You are using node " +
      process.version +
      ", wbo requires at least " +
      MIN_NODE_VERSION +
      " !!!"
  );
}

check_output_directory(config.HISTORY_DIR);

sockets.start(app);

app.listen(config.PORT, config.HOST);
log("server started", { port: config.PORT });

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

const fileserver = serveStatic(config.WEBROOT, {
  maxAge: 2 * 3600 * 1000,
  setHeaders: function (res) {
    res.setHeader("X-UA-Compatible", "IE=Edge");
    res.setHeader("Content-Security-Policy", CSP);
  },
});

function serveError(request, response) {
  const errorPage = fs.readFileSync(path.join(config.WEBROOT, "error.html"));
  return function (err) {
    log("error", { error: err && err.toString(), url: request.url });
    response.writeHead(err ? 500 : 404, { "Content-Length": errorPage.length });
    response.end(errorPage);
  };
}

/**
 * Write a request to the logs
 * @param {import("http").IncomingMessage} request
 */
function logRequest(request) {
  log("connection", {
    ip: request.socket.remoteAddress,
    original_ip:
      request.headers["x-forwarded-for"] || request.headers["forwarded"],
    user_agent: request.headers["user-agent"],
    referer: request.headers["referer"],
    language: request.headers["accept-language"],
    url: request.url,
  });
}

/**
 * @type {import('http').RequestListener}
 */
function handler(request, response) {
  try {
    handleRequestAndLog(request, response);
  } catch (err) {
    console.trace(err);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(err.toString());
  }
}

const boardTemplate = new templating.BoardTemplate(
  path.join(config.WEBROOT, "board.html")
);
const indexTemplate = new templating.Template(
  path.join(config.WEBROOT, "index.html")
);

/**
 * Throws an error if the given board name is not allowed
 * @param {string} boardName
 * @throws {Error}
 */
function validateBoardName(boardName) {
  if (/^[\w%\-_~()]*$/.test(boardName)) return boardName;
  throw new Error("Illegal board name: " + boardName);
}

/**
 * Throws an error if the user does not have permission
 * @param {URL} url
 * @throws {Error}
 */
function checkUserPermission(url) {
  if(config.AUTH_SECRET_KEY !== "") {
    const token = url.searchParams.get("token");
    if(token) {
      jsonwebtoken.verify(token, config.AUTH_SECRET_KEY);
    } else { // Error out as no token provided
      throw new Error("No token provided");
    }
  }
}

/**
 * @type {import('http').RequestListener}
 */
function handleRequest(request, response) {
  const parsedUrl = new URL(request.url, 'http://wbo/');
  const parts = parsedUrl.pathname.split("/");

  if (parts[0] === "") parts.shift();

  const fileExt = path.extname(parsedUrl.pathname);
  const staticResources = ['.js','.css', '.svg', '.ico', '.png', '.jpg', '.gif', '.css'];
  // If we're not being asked for a file, then we should check permissions.
  if(fileExt && !staticResources.includes(fileExt)) {
    checkUserPermission(parsedUrl);
  }

  const alreadyExists = name => {
    return fs.readdirSync(config.HISTORY_DIR)
        .map(e => e.split(".")[0])
        .includes("board-" + name);
  }

  switch (parts[0]) {
    case "boards":
      // "boards" refers to the root directory
      if (parts.length === 1) {
        // '/boards?board=...' This allows html forms to point to boards
        const boardName = parsedUrl.searchParams.get("board") || "anonymous";
        const headers = { Location: "boards/" + encodeURIComponent(boardName) };
        response.writeHead(301, headers);
        response.end();
      } else if (parts.length === 2 && parsedUrl.pathname.indexOf(".") === -1) {
        // Check for auth if board doesn't already exist
        if (!alreadyExists(parts[1])) {
          checkUserPermission(parsedUrl);
        }

        validateBoardName(parts[1]);
        boardTemplate.serve(request, response);
        // If there is no dot and no directory, parts[1] is the board name
      } else {
        request.url = "/" + parts.slice(1).join("/");
        fileserver(request, response, serveError(request, response));
      }
      break;

    case "download": {
      // Auth secured endpoint
      checkUserPermission(parsedUrl);

      const boardName = validateBoardName(parts[1]);
      let history_file = path.join(
              config.HISTORY_DIR,
              "board-" + boardName + ".json"
          );
      if (parts.length > 2 && /^[0-9A-Za-z.\-]+$/.test(parts[2])) {
        history_file += "." + parts[2] + ".bak";
      }
      log("download", {file: history_file});
      fs.readFile(history_file, function (err, data) {
        if (err) return serveError(request, response)(err);
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="' + boardName + '.wbo"',
          "Content-Length": data.length,
        });
        response.end(data);
      });
      break;
    }

    case "export":
    case "preview": {
      // Auth secured endpoint
      checkUserPermission(parsedUrl);

      const boardName = validateBoardName(parts[1]),
          history_file = path.join(
              config.HISTORY_DIR,
              "board-" + boardName + ".json"
          );
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Content-Security-Policy": CSP,
        "Cache-Control": "public, max-age=30",
      });
      const t = Date.now();
      createSVG
          .renderBoard(history_file, response)
          .then(function () {
            log("preview", {board: boardName, time: Date.now() - t});
            response.end();
          })
          .catch(function (err) {
            log("error", {error: err.toString(), stack: err.stack});
            response.end("<text>Sorry, an error occured</text>");
          });
      break;
    }

    case "random": {
      // Auth secured endpoint
      checkUserPermission(parsedUrl);

      const name = crypto
          .randomBytes(32)
          .toString("base64")
          .replace(/[^\w]/g, "-");
      response.writeHead(307, {Location: "boards/" + name});
      response.end(name);
      break;
    }

    case "polyfill.js": // serve tailored polyfills
    case "polyfill.min.js":
      polyfillLibrary
        .getPolyfillString({
          uaString: request.headers["user-agent"],
          minify: request.url.endsWith(".min.js"),
          features: {
            default: { flags: ["gated"] },
            es5: { flags: ["gated"] },
            es6: { flags: ["gated"] },
            es7: { flags: ["gated"] },
            es2017: { flags: ["gated"] },
            es2018: { flags: ["gated"] },
            es2019: { flags: ["gated"] },
            "performance.now": { flags: ["gated"] },
          },
        })
        .then(function (bundleString) {
          response.setHeader(
            "Cache-Control",
            "private, max-age=172800, stale-while-revalidate=1728000"
          );
          response.setHeader("Vary", "User-Agent");
          response.setHeader("Content-Type", "application/javascript");
          response.end(bundleString);
        });
      break;

    case "": // Index page
      logRequest(request);
        indexTemplate.serve(request, response);
      break;

    default:
      fileserver(request, response, serveError(request, response));
  }
}

const handleRequestAndLog = monitorFunction(handleRequest);
module.exports = app;
