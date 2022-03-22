let fs = require("./fs_promises.js"),
	log = require("./log.js").log,
	path = require("path"),
	config = require("./configuration.js");

/**
 * Run the backup cycle.
 * * backs up new boards
 * * take new snapshot if it's outdated
 * * remove old backup if limit for # of copies per board is reached
 * @returns {Promise<void>}
 */
async function takeBackup() {
	const boardFiles = await fs.readdir(config.HISTORY_DIR);
	const backupFiles = await fs.readdir(config.BACKUP_DIR);

	const list = await backupList(boardFiles, backupFiles);
	const {toDestroy, toBackup} = segregateBackups(list);

	// First do list of backups, then delete
	await Promise.all(toBackup.map(backupFile));
	await Promise.all(toDestroy.map(deleteBackup));

	console.info(`${toBackup.length} boards backed up\n${toDestroy.length} old backups removed`);
}

/**
 * Asynchronously backs up a board by name. Rejects with error in case something happens
 * @param {String} boardName The (full) name of the board to back up, without extension. E.g. 'board-anonymous'
 * @returns {Promise<String>} The name of the backup file, e.g. 'board-anonymous__916298476'
 */
function backupFile(boardName) {
	return new Promise((r,rj) => {
		try {
			const rs = fs.createReadStream(
				path.join(config.HISTORY_DIR,
					boardName+".json")
			);

			const backupName = `${boardName}__${Date.now().toString()}`;
			const ws = fs.createWriteStream(
				path.join(
					config.BACKUP_DIR,
					backupName+".json"
				)
			);

			rs.pipe(ws);
			rs.on("end", () => {
				ws.destroy();
				rs.destroy();
				return r(backupName);
			});

			rs.on("error", err => throw err);
			ws.on("error", err => throw err);
		} catch(err) {
			return rj(err);
		}

	});
}

/**
 * Deletes an old backup file by its name, e.g. 'board-anonymous__916298476' (with or without .json ending)
 * @param {String} boardName The name of the backup, e.g. 'board-anonymous__916298476'
 * @returns {Promise<void>}
 */
async function deleteBackup(boardName) {
	let p = path.join(config.BACKUP_DIR, boardName);
	if (!p.endsWith(".json")) p += ".json";

	try {
		const handle = await fs.open(p, fs.constants.R_OK);
		handle.close();
	} catch(_) {
		return;
	}

	return fs.unlink(p);
}

/**
 * Creates two lists;
 * * names of boards that need being backed up
 * * names of old backups that should be deleted
 * @param {Object<String, Array<Number>>} backups
 * @returns {{toBackup: Array<String>, toDestroy: Array<String>}}
 */
function segregateBackups(backups) {
	const toBackup = Array();
	const toDestroy = Array();
	for (const key in backups) {
		if (config.BACKUP_COPIES<1) continue;

		const current = backups[key];

		// No backups, so it definitely needs one
		if (!current.length) {
			toBackup.push(key);
			continue;
		}

		// Latest backup should be first; check if we need backup
		if ((Date.now() - current[0]) < config.BACKUP_INTERVAL_MS) continue;

		toBackup.push(key);

		// Check if we reached max backup count
		if (current.length >= config.BACKUP_COPIES) {
			const surplus = current.slice(config.BACKUP_COPIES+1);
			toDestroy.push(
				surplus.map(tx => {
					return key+"__"+tx.toString()
				})
			);
		}
	}

	return {
		toBackup,
		toDestroy
	};
}

/**
 * Get a list of board names that need to be backed up.
 * Checks are based on the last date the respective board was backed up
 * @param {Array<String>} boardFiles A list of files in the active boards folder
 * @param {Array<String>} backupFiles A list of files in the backup folder
 * @returns {Promise<Object<String, Array<Number>>>} A list of board names and the Timestamp they were backed up, sorted by latest first
 */
async function backupList(boardFiles, backupFiles) {
	const boardNames = boardFiles.map(n => n.split(".")[0]);

	if (!backupFiles.length) {
		const backups = Object();
		for (let i=0;i<boardNames.length;i++) backups[boardNames[i]] = Array();
		return backups;
	}

	const backups = _sortBackups(backupFiles, boardNames);

	// Add new files that have never been backed up before
	for (let i=0;i<boardNames.length;i++) {
		if (!(boardNames[i] in backups)) backupFiles[boardNames[i]] = Array();
	}

	return backups;
}

/**
 * Categorizes backed up boards into arrays of dates they got backed up
 * @param {Array<String>} backedUpFiles A list of filenames of backed up files
 * @param {Array<string>} nameWhitelist An array of names a backup must have for it to be on the list. To avoid deleting old backups of boards that no longer exist.
 * @returns {Object<String, Array<Number>>} Newest backup first
 */
function _sortBackups(backedUpFiles, nameWhitelist) {
	// Make map of backed up boards
	const backedUp = Object();
	for (let i=0;i<backedUpFiles.length;i++) {
		// board-name-here__1647275441964.json
		const name = backedUpFiles[i].split("__").slice(0,-1).join("__");

		// Skip old backups that no longer exist as boards
		if (!nameWhitelist.includes(name)) continue;

		const unixTimestamp = parseInt(
			backedUpFiles[i].replace(name+"__","").split(".")[0]
		);

		if (!(name in backedUp)) backedUp[name] = Array();
		backedUp[name].push(unixTimestamp);
	}

	// Sort backup dates
	for (const key in backedUp) backedUp[key].sort().reverse();

	return backedUp;
}

module.exports = {
	takeBackup
};