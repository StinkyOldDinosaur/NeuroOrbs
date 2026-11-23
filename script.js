// ---------- Settings ----------
const STORAGE_KEY = "neuroorbs-progress-v2"; // new slot, because the data format changed
const GOAL = 6;             // daily orb goal
const MAX_HEARTS = 3;       // wrong tries per riddle before orbs stop
const ORBS_PER_RIDDLE = 3;  // maximum orbs per riddle

// Today's date as YYYY-MM-DD
const today = new Date().toLocaleDateString("sv-SE");

// Read ?date=... from the address bar, otherwise use today
const params = new URLSearchParams(location.search);
let currentDate = params.get("date") || today;
// accept only the format YYYY-MM-DD, and never future days
if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate) || currentDate > today) currentDate = today;

// ---------- Saving progress in the browser ----------
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
// State of one riddle: which answers are found, hearts left, orbs earned
function getState(date, index) {
  const day = loadProgress()[date] || {};
  return day[index] || { found: [], hearts: MAX_HEARTS, orbs: 0 };
}
function saveState(date, index, state) {
  const progress = loadProgress();
  progress[date] = progress[date] || {};
  progress[date][index] = state;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch {}
}
function totalOrbs(date) {
  const day = loadProgress()[date] || {};
  return Object.values(day).reduce((sum, s) => sum + s.orbs, 0);
}

// ---------- Orb rule: one orb per third of the required answers ----------
function orbsFor(foundCount, total) {
  return Math.min(ORBS_PER_RIDDLE, Math.floor((foundCount * ORBS_PER_RIDDLE) / total));
}

// ---------- Forgiving text answers ----------
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9 ]/g, "")                       // remove punctuation
    .trim();
}
// Number of single-letter edits between two words (typo measure)
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}
// Does the typed text match any accepted spelling of one answer?
function isCorrect(input, spellings) {
  const typed = normalize(input);
  return spellings.some(spelling => {
    const target = normalize(spelling);
    // short words: no typos allowed; medium: 1; long: 2
    const allowed = target.length <= 4 ? 0 : target.length <= 8 ? 1 : 2;
    return distance(typed, target) <= allowed;
  });
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

// ---------- Status bar and archive ----------
function updateStatus() {
  const total = totalOrbs(currentDate);
  document.getElementById("status").textContent =
    `${currentDate} · Orbs: ${total}/${GOAL}` + (total >= GOAL ? " 🎉 Goal reached!" : "");
}
function renderArchive(dates) {
  const list = document.getElementById("archive");
  dates
    .filter(date => date <= today)
    .sort().reverse()
    .forEach(date => {
      const total = totalOrbs(date);
      const li = document.createElement("li");
      li.innerHTML = `<a href="?date=${date}">${date}</a> – ${total}/${GOAL} orbs ${total >= GOAL ? "✅" : ""}`;
      list.appendChild(li);
    });
}

// ---------- Building one riddle ----------
function buildRiddle(riddle, index, container) {
  const isMatch = riddle.type === "match";
  const total = isMatch ? riddle.pairs.length : (riddle.needed || riddle.answers.length);
  if (total < 3) console.warn(`Riddle ${index + 1} on ${currentDate} has fewer than 3 right answers.`);

  const state = getState(currentDate, index);

  const box = document.createElement("div");
  box.className = "riddle";
  box.innerHTML = `
    <p class="prompt"></p>
    <p class="info"></p>
    <div class="body"></div>
    <p class="feedback"></p>`;
  box.querySelector(".prompt").textContent = riddle.prompt;
  container.appendChild(box);

  const info = box.querySelector(".info");
  const body = box.querySelector(".body");
  const feedback = box.querySelector(".feedback");

  // Redraw hearts, orbs and counter
  function refresh() {
    const hearts = "❤️".repeat(state.hearts) + "🖤".repeat(MAX_HEARTS - state.hearts);
    const orbs = "🔮".repeat(state.orbs) + "⚪".repeat(ORBS_PER_RIDDLE - state.orbs);
    info.innerHTML = `${hearts} &nbsp; ${orbs} &nbsp; Found: ${state.found.length}/${total}` +
      (state.hearts === 0 ? ' <span class="nohearts">No hearts left: no more orbs</span>' : "");
    updateStatus();
  }
  function persist() {
    saveState(currentDate, index, state);
    refresh();
  }
  // A right answer earns orbs only while hearts are left
  function rightAnswer() {
    if (state.hearts > 0) {
      state.orbs = Math.max(state.orbs, orbsFor(state.found.length, total));
    }
  }
  // A wrong answer costs one heart
  function wrongAnswer() {
    if (state.hearts > 0) {
      state.hearts--;
      feedback.textContent = state.hearts > 0
        ? "Wrong. You lost a heart."
        : "Wrong. No hearts left: you can keep going, but no more orbs.";
    } else {
      feedback.textContent = "Wrong.";
    }
  }

  // ----- Text riddle -----
  function buildText() {
    body.innerHTML = `
      <input type="text" placeholder="Type one answer">
      <button>Check</button>
      <ul class="found"></ul>`;
    const input = body.querySelector("input");
    const button = body.querySelector("button");
    const list = body.querySelector(".found");

    function drawFound() {
      list.innerHTML = "";
      state.found.forEach(i => {
        const li = document.createElement("li");
        li.textContent = riddle.answers[i][0];
        list.appendChild(li);
      });
      if (state.found.length >= total) {
        input.disabled = true;
        button.disabled = true;
        feedback.textContent = "All answers found! 🎉";
      }
    }

    function submit() {
      if (normalize(input.value) === "") return;
      const hit = riddle.answers.findIndex(group => isCorrect(input.value, group));
      if (hit === -1) {
        wrongAnswer();
      } else if (state.found.includes(hit)) {
        feedback.textContent = "You already found that one.";
      } else {
        state.found.push(hit);
        rightAnswer();
        feedback.textContent = "Correct!";
      }
      input.value = "";
      persist();
      drawFound();
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    drawFound();
  }

  // ----- Matching riddle -----
  function buildMatch() {
    body.innerHTML = `<div class="match"><div class="col left"></div><div class="col right"></div></div>`;
    const leftCol = body.querySelector(".left");
    const rightCol = body.querySelector(".right");
    let selected = null;

    riddle.pairs.forEach((pair, i) => {
      const btn = document.createElement("button");
      btn.textContent = pair[0];
      if (state.found.includes(i)) btn.classList.add("matched");
      btn.addEventListener("click", () => {
        if (state.found.includes(i)) return;
        leftCol.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        selected = { i, btn };
      });
      leftCol.appendChild(btn);
    });

    shuffle(riddle.pairs.map((pair, i) => ({ text: pair[1], i }))).forEach(item => {
      const btn = document.createElement("button");
      btn.textContent = item.text;
      if (state.found.includes(item.i)) btn.classList.add("matched");
      btn.addEventListener("click", () => {
        if (!selected || state.found.includes(item.i)) return;
        if (selected.i === item.i) {
          state.found.push(item.i);
          selected.btn.classList.remove("selected");
          selected.btn.classList.add("matched");
          btn.classList.add("matched");
          selected = null;
          rightAnswer();
          feedback.textContent = state.found.length >= total ? "All pairs found! 🎉" : "Correct pair!";
        } else {
          wrongAnswer();
        }
        persist();
      });
      rightCol.appendChild(btn);
    });

    if (state.found.length >= total) feedback.textContent = "All pairs found! 🎉";
  }

  if (isMatch) buildMatch(); else buildText();
  refresh();
}

// ---------- Start ----------
async function start() {
  const container = document.getElementById("riddles");
  try {
    const response = await fetch("riddles.json");
    const all = await response.json();
    const riddles = all[currentDate] || [];

    if (riddles.length === 0) container.textContent = "No riddles for this day.";
    riddles.forEach((riddle, index) => buildRiddle(riddle, index, container));

    updateStatus();
   function renderArchive(dates) {
  const list = document.getElementById("archive");
  dates
    .filter(date => date <= today)
    .sort().reverse()
    .forEach(date => {
      const total = totalOrbs(date);
      const li = document.createElement("li");
      li.innerHTML = `<a href="?date=${date}">${date}</a> – ${total}/${GOAL} orbs ${total >= GOAL ? "✅" : ""}`;
      list.appendChild(li);
    });
}
  } catch (error) {
    container.textContent = "Could not load riddles.json. Check the file for typos (press F12 for details).";
    console.error(error);
  }
}
async function start() {
  const container = document.getElementById("riddles");
  try {
    // 1. Archive list
    const indexResponse = await fetch("days/index.json");
    const dates = await indexResponse.json();
    renderArchive(dates);
    updateStatus();

    // 2. The riddles of the selected day
    const dayResponse = await fetch(`days/${currentDate}.json`);
    if (!dayResponse.ok) {
      container.textContent = "No riddles for this day.";
      return;
    }
    const riddles = await dayResponse.json();
    riddles.forEach((riddle, index) => buildRiddle(riddle, index, container));
    updateStatus();
  } catch (error) {
    container.textContent = "Could not load the riddles. Check the JSON files for typos (press F12 for details).";
    console.error(error);
  }
}
start();