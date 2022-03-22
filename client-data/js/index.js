function showRecentBoards() {
  const parent = document.getElementById("recent-boards");
  const ul = document.querySelector("#recent-boards ul");
  ul && parent.removeChild(ul);
  parent.classList.add("hidden");

  const recentBoards = JSON.parse(localStorage.getItem("recent-boards")) || [];
  if (recentBoards.length === 0) return;

  const list = document.createElement("ul");

  recentBoards.forEach(function(name) {
    const listItem = document.createElement("li");
    const link = document.createElement("a");
    link.setAttribute("href", `/boards/${encodeURIComponent(name)}`);
    link.textContent = name;
    listItem.appendChild(link);
    list.appendChild(listItem);
  });

  parent.appendChild(list);
  parent.classList.remove("hidden");
}

window.addEventListener("pageshow", showRecentBoards);

// Automatically add JWT to 'random' button
// Random button:
const inputA = document.getElementById("jwt1");
inputA.addEventListener("input", e => {
  const go = document.getElementById("random-button");
  if (!go) return;
  if (!go.dataset.original) go.dataset.original = go.href;
  go.href = go.dataset.original + `?token=${e.target.value}`;
});

const inputB = document.getElementById("jwt2");
const name = document.getElementById("board");
const go = document.getElementById("new-board");
name.addEventListener("input", e => {
  if (!go || !name) return;
  go.action = `boards/${name.value}` + `?token=${inputB.value}`;
});

inputB.addEventListener("input", e => {
  if (!go || !name) return;
  go.action = `boards/${name.value}` + `?token=${inputB.value}`;
});
document.getElementById("newBoardBtn").addEventListener("click",e => {
  e.preventDefault();
  window.location.href = go.action;
});