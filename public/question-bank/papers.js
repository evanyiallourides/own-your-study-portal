/* ==========================================================================
   Own Your IB — Mock papers
   The shelf on papers.html and the paper itself on paper.html.

   A paper is not a question bank. You do not filter it or shuffle it: you sit
   it in order, against a clock, and mark it at the end. So this is its own
   script rather than another mode of the bank viewer, and it shares only the
   stylesheet and the storage conventions.

   Data comes from papers/*.json on the marketing site, where every paper but
   one is metadata only, or from an API in the portal, where a paying student
   gets all of them. The page never decides that: a paper it cannot fetch in
   full is a paper it shows locked.
   ========================================================================== */

let PP_DATA = "papers/";
let PP_VIEW = "paper.html";
let PP_BACK = "papers.html";

function ppReadConfig() {
  const host = document.querySelector("[data-pp-base]");
  if (!host) return;
  PP_DATA = host.dataset.ppBase || PP_DATA;
  PP_VIEW = host.dataset.ppView || PP_VIEW;
  PP_BACK = host.dataset.ppBack || PP_BACK;
}

const PP_KEY = "oyib.papers.v1";

function ppLoad() {
  try {
    return JSON.parse(localStorage.getItem(PP_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function ppSave(state) {
  try {
    localStorage.setItem(PP_KEY, JSON.stringify(state));
  } catch (e) {
    /* private browsing or a full quota — the paper still works, unsaved */
  }
}

function ppFor(state, id) {
  if (!state[id]) state[id] = { marks: {}, chosen: {}, elapsed: 0, started: null };
  const p = state[id];
  if (!p.marks) p.marks = {};
  if (!p.chosen) p.chosen = {};
  if (typeof p.elapsed !== "number") p.elapsed = 0;
  return p;
}

function ppEl(id) { return document.getElementById(id); }

function ppEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function ppClock(seconds) {
  const negative = seconds < 0;
  const t = Math.abs(Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (negative ? "+" : "") + (h ? h + ":" : "") + pad(m) + ":" + pad(s);
}

function ppDuration(minutes) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h ? h + "h" : "") + (m ? (h ? " " : "") + m + "m" : "");
}

function ppTitle(p) {
  return p.short + " " + p.level + " · " + p.paper +
    (p.zone ? " " + p.zone : "");
}

/* ==========================================================================
   The shelf
   ========================================================================== */
function initPaperShelf(shelf) {
  const empty = ppEl("pp-shelf-empty");
  const filters = { subject: "all", session: "all" };
  let papers = [];

  fetch(PP_DATA + "index.json")
    .then((r) => r.json())
    .then((data) => { papers = data.papers; render(); })
    .catch(() => {
      shelf.innerHTML = "";
      if (empty) { empty.hidden = false; empty.textContent = "The paper list could not be loaded."; }
    });

  document.querySelectorAll("#pp-filters .group").forEach((group) => {
    const key = group.dataset.filter;
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".qb-pill");
      if (!btn) return;
      filters[key] = btn.dataset.value;
      group.querySelectorAll(".qb-pill").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn)));
      render();
    });
  });

  function render() {
    const state = ppLoad();
    const shown = papers.filter((p) =>
      (filters.subject === "all" || p.short === filters.subject) &&
      (filters.session === "all" || p.session === filters.session));

    if (empty) empty.hidden = shown.length > 0;
    shelf.innerHTML = shown.map((p) => {
      const mine = state[p.id];
      const marked = mine ? Object.keys(mine.marks || {}).length : 0;
      return '<article class="pp-card">' +
        '<div class="meta">' +
          '<span class="qb-chip level">' + ppEsc(p.level) + "</span>" +
          '<span class="qb-chip">' + ppEsc(p.session) + "</span>" +
          (p.calculator === false ? '<span class="qb-chip nocalc">No calculator</span>' : "") +
          (p.locked ? "" : '<span class="qb-chip free">Free</span>') +
        "</div>" +
        "<h3>" + ppEsc(p.subject) + "</h3>" +
        '<div class="sub">' + ppEsc(p.paper) + (p.zone ? " · " + ppEsc(p.zone) : "") + "</div>" +
        "<dl>" +
          "<div><dt>Marks</dt><dd>" + p.maxMark + "</dd></div>" +
          "<div><dt>Time</dt><dd>" + ppDuration(p.durationMinutes) + "</dd></div>" +
          "<div><dt>Qs</dt><dd>" + p.count + "</dd></div>" +
        "</dl>" +
        (marked ? '<p style="font-size:0.8rem;color:var(--qb-easy);font-weight:600;margin:10px 0 0;">' +
          marked + " question" + (marked === 1 ? "" : "s") + " marked</p>" : "") +
        '<a class="btn btn-dark btn-block" href="' + PP_VIEW + "?paper=" +
          encodeURIComponent(p.id) + '">' +
          (p.locked ? "See what's in it" : marked ? "Resume" : "Sit this paper") +
        "</a>" +
        "</article>";
    }).join("");
  }
}

/* ==========================================================================
   Sitting one paper
   ========================================================================== */
function initPaper() {
  const params = new URLSearchParams(location.search);
  const id = params.get("paper");
  if (!id || !/^[a-z0-9-]+$/.test(id)) return ppFail("No paper was named in the link.");

  fetch(PP_DATA + id + ".json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => { ppFail("We could not find a paper called “" + id + "”."); return null; })
    // Outside the catch on purpose: a fault in the renderer is not a missing
    // paper, and reporting it as one sends people hunting the wrong problem.
    .then((paper) => { if (paper) renderPaper(paper); });
}

function ppFail(detail) {
  const root = ppEl("pp-root");
  if (!root) return;
  root.innerHTML = '<div class="qb-state"><h2>That paper could not be loaded.</h2><p>' +
    ppEsc(detail) + '</p><a href="' + PP_BACK +
    '" class="btn btn-dark" style="margin-top:14px;">Back to all papers</a></div>';
}

function renderPaper(paper) {
  const root = ppEl("pp-root");
  const state = ppLoad();
  const mine = ppFor(state, paper.id);
  const locked = paper.locked === true;
  const readable = (q) => Boolean((q.stem && q.stem.length) || (q.parts && q.parts.length));

  document.title = ppTitle(paper) + " Mock | Own Your IB";

  /* ---------- head ---------- */
  const chips = [
    '<span class="qb-chip level">' + ppEsc(paper.level) + "</span>",
    '<span class="qb-chip">' + ppEsc(paper.session) + "</span>",
    paper.zone ? '<span class="qb-chip">' + ppEsc(paper.zone) + "</span>" : "",
    paper.calculator === false
      ? '<span class="qb-chip nocalc">No calculator</span>'
      : paper.calculator === true ? '<span class="qb-chip calc">Calculator</span>' : "",
    locked ? '<span class="qb-chip locked">Locked</span>' : '<span class="qb-chip free">Free paper</span>',
  ].join("");

  let html =
    '<a href="' + PP_BACK + '" class="back" style="display:inline-block;margin-bottom:18px;' +
      'font-size:0.86rem;font-weight:600;color:var(--ink-soft);">&larr; All papers</a>' +
    '<header class="pp-head">' +
      '<div class="meta">' + chips + "</div>" +
      "<h1>" + ppEsc(paper.subject) + " " + ppEsc(paper.level) + "</h1>" +
      '<div class="sub">' + ppEsc(paper.paper) +
        (paper.zone ? " · " + ppEsc(paper.zone) : "") + " · " + ppEsc(paper.session) +
        " topic-matched mock</div>" +
      '<p class="rules"><b>' + paper.maxMark + " marks</b> · " +
        ppDuration(paper.durationMinutes) +
        (paper.durationSource === "standard"
          ? " (the standard length for this paper — the mock states none)" : "") +
        (paper.count ? " · " + paper.count + " questions" : "") + "</p>" +
      (paper.instructions && paper.instructions.length
        ? '<p class="rules" style="margin-top:8px;">' +
          paper.instructions.map(ppEsc).join(" ") + "</p>" : "") +
      // Stated separately on the paper, so shown separately here.
      (paper.technology
        ? '<p class="rules" style="margin-top:6px;"><b>Technology:</b> ' +
          ppEsc(paper.technology) + "</p>" : "") +
      (paper.answerStandard
        ? '<p class="rules" style="margin-top:6px;"><b>Answer standard:</b> ' +
          ppEsc(paper.answerStandard) + "</p>" : "");

  if (!locked && paper.durationMinutes) {
    html +=
      '<div class="pp-timer">' +
        '<span class="pp-clock" id="pp-clock">' + ppClock(paper.durationMinutes * 60) + "</span>" +
        '<button class="go" id="pp-start">Start</button>' +
        '<button id="pp-reset">Reset</button>' +
        '<p class="note">The clock is for you — nothing is submitted and nothing is timed out.</p>' +
      "</div>";
  }
  html += "</header>";

  if (locked) {
    html += ppLockedBody(paper);
  } else {
    let section = -1;
    paper.questions.forEach((q) => {
      if (q.section !== section && paper.sections[q.section]) {
        section = q.section;
        html += '<h2 class="pp-section">' + ppEsc(paper.sections[section].title) + "</h2>";
      }
      html += ppQuestion(q, paper, mine);
    });
    html +=
      '<div class="pp-total" id="pp-total">' +
        "<span><b id=\"pp-score\">0</b> / " + paper.maxMark + "</span>" +
        '<span class="pct" id="pp-pct"></span>' +
        '<span class="spacer"></span>' +
        '<button id="pp-reveal-all">Show all marking</button>' +
        '<button id="pp-clear">Clear my marks</button>' +
      "</div>";
  }

  root.innerHTML = html;
  if (locked) return;

  wireTimer(paper, mine, state);
  wireMarking(paper, mine, state, readable);
}

function ppLockedBody(paper) {
  const rows = paper.questions.map((q) =>
    "<li><span class=\"lab\">" + q.n + "</span><span>" +
    ppEsc(q.title || "Question " + q.n) + "</span><span class=\"mk\">[" + q.marks + "]</span></li>"
  ).join("");

  return '<div class="pp-q" style="margin-top:20px;">' +
    "<h3>What is in this paper</h3>" +
    '<ul class="pp-parts">' + rows + "</ul>" +
    '<div class="qb-redact" aria-hidden="true" style="margin-top:26px;"><i></i><i></i><i></i></div>' +
    '<div class="qb-lockcta">' +
      '<div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/>' +
        '<path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>' +
      "<h3>This paper is behind the gate</h3>" +
      "<p>One complete paper is free to sit. Unlock the rest to get every question, " +
        "its marking points and the worked solutions.</p>" +
      '<p class="facts"><b>' + paper.count + " questions · " + paper.maxMark +
        " marks · " + ppDuration(paper.durationMinutes) + "</b></p>" +
      '<div class="actions">' +
        '<a class="btn btn-primary" href="contact.html?package=question-bank">Get access, $45/mo</a>' +
        '<a class="btn btn-outline-dark" href="pricing.html#calculator">Free at 20+ pooled hours</a>' +
      "</div>" +
    "</div></div>";
}

function ppQuestion(q, paper, mine) {
  let html = '<article class="pp-q" id="pp-q-' + q.n + '">' +
    "<header><span class=\"n\">Question " + q.n + "</span>" +
    "<span class=\"marks\">[" + q.marks + "]</span></header>";

  if (q.title) html += "<h3>" + ppEsc(q.title) + "</h3>";
  if (q.stem && q.stem.length) {
    html += '<div class="stem">' + q.stem.map((p) => "<p>" + p + "</p>").join("") + "</div>";
  }

  if (q.table && q.table.length) {
    const [head, ...body] = q.table;
    html += '<div class="pp-table-wrap"><table class="pp-table"><thead><tr>' +
      head.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
      body.map((row) => "<tr>" + row.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") +
      "</tbody></table></div>";
  }

  if (q.options && q.options.length) {
    const picked = mine.chosen[q.n];
    html += '<ul class="pp-options" data-q="' + q.n + '">' + q.options.map((o) =>
      '<li><button type="button" data-key="' + o.k + '" aria-pressed="' +
      String(picked === o.k) + '"><span class="key">' + o.k + "</span><span>" +
      o.html + "</span></button></li>").join("") + "</ul>";
  }

  if (q.parts && q.parts.length) {
    html += '<ul class="pp-parts">' + q.parts.map((p) =>
      '<li><span class="lab">(' + p.label + ')</span><span>' + p.html +
      '</span><span class="mk">' + (p.marks ? "[" + p.marks + "]" : "") + "</span></li>").join("") +
      "</ul>";
  }

  html += '<button class="reveal" data-reveal="' + q.n + '">Show marking</button>' +
    '<div class="pp-mark" data-mark="' + q.n + '" hidden>' + ppMarking(q) +
    '<div class="pp-score"><label for="pp-m-' + q.n + '">Marks you scored</label>' +
      '<input id="pp-m-' + q.n + '" type="number" min="0" max="' + q.marks +
      '" step="1" data-score="' + q.n + '" value="' +
      (mine.marks[q.n] !== undefined ? mine.marks[q.n] : "") + '"> of ' + q.marks +
    "</div></div></article>";
  return html;
}

function ppMarking(q) {
  let html = "<h4>" + (q.answer ? "Answer: " + q.answer : "Marking points") + "</h4>";
  if (q.solparts && q.solparts.length) {
    html += '<ul class="pp-parts">' + q.solparts.map((p) =>
      '<li><span class="lab">(' + p.label + ')</span><span>' + p.html +
      '</span><span class="mk">' + (p.marks ? "[" + p.marks + "]" : "") + "</span></li>").join("") +
      "</ul>";
  }
  if (q.solution && q.solution.length) {
    html += '<div class="sol">' + q.solution.map((p) => "<p>" + p + "</p>").join("") + "</div>";
  }
  return html;
}

/* ---------- the clock ---------- */
function wireTimer(paper, mine, state) {
  const clock = ppEl("pp-clock");
  if (!clock) return;
  const total = paper.durationMinutes * 60;
  let ticking = false;
  let tick = null;

  function paint() {
    const left = total - mine.elapsed;
    clock.textContent = ppClock(left);
    clock.classList.toggle("low", left <= 300 && left > 0);
    clock.classList.toggle("over", left <= 0);
  }

  ppEl("pp-start").addEventListener("click", (e) => {
    ticking = !ticking;
    e.target.textContent = ticking ? "Pause" : "Resume";
    e.target.classList.toggle("go", !ticking);
    if (ticking) {
      tick = setInterval(() => {
        mine.elapsed += 1;
        paint();
        // Written once a minute rather than once a second: the point is to
        // survive a reload, not to record every tick.
        if (mine.elapsed % 60 === 0) ppSave(state);
      }, 1000);
    } else {
      clearInterval(tick);
      ppSave(state);
    }
  });

  ppEl("pp-reset").addEventListener("click", () => {
    clearInterval(tick);
    ticking = false;
    mine.elapsed = 0;
    const start = ppEl("pp-start");
    start.textContent = "Start";
    start.classList.add("go");
    ppSave(state);
    paint();
  });

  window.addEventListener("beforeunload", () => { if (ticking) ppSave(state); });
  paint();
}

/* ---------- marking ---------- */
function wireMarking(paper, mine, state, readable) {
  const root = ppEl("pp-root");
  const byNumber = {};
  paper.questions.forEach((q) => { byNumber[q.n] = q; });

  function total() {
    let scored = 0;
    Object.keys(mine.marks).forEach((n) => { scored += Number(mine.marks[n]) || 0; });
    ppEl("pp-score").textContent = scored;
    const done = Object.keys(mine.marks).length;
    ppEl("pp-pct").textContent = done
      ? Math.round((scored / paper.maxMark) * 100) + "% · " + done + " of " +
        paper.questions.length + " marked"
      : "Mark each question as you check it.";
  }

  root.addEventListener("click", (e) => {
    const reveal = e.target.closest("[data-reveal]");
    if (reveal) {
      const box = root.querySelector('[data-mark="' + reveal.dataset.reveal + '"]');
      box.hidden = !box.hidden;
      reveal.textContent = box.hidden ? "Show marking" : "Hide marking";
      // Checking the answer is when a multiple-choice question gets graded.
      if (!box.hidden) gradeOptions(reveal.dataset.reveal);
      return;
    }

    const option = e.target.closest(".pp-options button");
    if (option) {
      const n = option.closest(".pp-options").dataset.q;
      mine.chosen[n] = option.dataset.key;
      option.closest(".pp-options").querySelectorAll("button").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === option)));
      ppSave(state);
      return;
    }

    if (e.target.id === "pp-reveal-all") {
      root.querySelectorAll("[data-mark]").forEach((box) => { box.hidden = false; });
      root.querySelectorAll("[data-reveal]").forEach((b) => {
        b.textContent = "Hide marking";
        gradeOptions(b.dataset.reveal);
      });
      return;
    }

    if (e.target.id === "pp-clear") {
      if (!confirm("Clear your marks and answers for this paper?")) return;
      mine.marks = {};
      mine.chosen = {};
      ppSave(state);
      root.querySelectorAll("[data-score]").forEach((i) => { i.value = ""; });
      root.querySelectorAll(".pp-options button").forEach((b) => {
        b.classList.remove("right", "wrong");
        b.setAttribute("aria-pressed", "false");
      });
      total();
    }
  });

  function gradeOptions(n) {
    const q = byNumber[n];
    if (!q || !q.answer) return;
    const list = root.querySelector('.pp-options[data-q="' + n + '"]');
    if (!list) return;
    list.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("right", b.dataset.key === q.answer);
      b.classList.toggle("wrong",
        b.dataset.key === mine.chosen[n] && mine.chosen[n] !== q.answer);
    });
    // A multiple-choice question marks itself once the answer is out.
    if (mine.chosen[n] !== undefined && mine.marks[n] === undefined) {
      mine.marks[n] = mine.chosen[n] === q.answer ? q.marks : 0;
      const input = root.querySelector('[data-score="' + n + '"]');
      if (input) input.value = mine.marks[n];
      ppSave(state);
      total();
    }
  }

  root.addEventListener("input", (e) => {
    const score = e.target.closest("[data-score]");
    if (!score) return;
    const n = score.dataset.score;
    const cap = byNumber[n] ? byNumber[n].marks : 0;
    if (score.value === "") delete mine.marks[n];
    else mine.marks[n] = Math.max(0, Math.min(cap, Number(score.value) || 0));
    ppSave(state);
    total();
  });

  total();
}

/* ---------------- boot ---------------- */
function ppBoot() {
  ppReadConfig();
  const shelf = ppEl("pp-shelf");
  if (shelf) initPaperShelf(shelf);
  else if (ppEl("pp-root")) initPaper();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ppBoot);
} else {
  ppBoot();
}
