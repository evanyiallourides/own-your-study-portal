/* ==========================================================================
   Own Your IB — Question Banks
   One script for both pages: the shelf on question-banks.html and the viewer
   on question-bank.html. Data lives in question-banks/*.json, written by the
   extractor that reads the source PDFs, so nothing here is hand-maintained.
   ========================================================================== */

/* Where the bank JSON comes from.
 *
 * On the marketing site that is a folder of previews sitting beside the page.
 * In the portal it is an API route that checks the signed-in student's access
 * before answering a single request. The viewer is identical either way; what
 * differs is whether the server is willing to send the questions. */
let QB_DATA = "question-banks/";
let QB_BACK = "question-banks.html";
let QB_VIEW = "question-bank.html";

/* Read from the mount point rather than from globals set by an inline script:
 * a host that renders the container can put the three values on it as data
 * attributes, which needs no script to run first and no ordering to be got
 * right. Defaults above are the marketing site's own layout. */
function qbReadConfig() {
  const host = document.querySelector("[data-qb-base]");
  if (!host) return;
  QB_DATA = host.dataset.qbBase || QB_DATA;
  QB_VIEW = host.dataset.qbView || QB_VIEW;
  QB_BACK = host.dataset.qbBack || QB_BACK;
}

/* The viewer's markup lives here, not in the page.
 *
 * The portal needs the same viewer inside its own layout, and keeping a second
 * copy of 150 lines of structure in a React component would mean every future
 * change had to be made twice and would silently half-work when it wasn't.
 * Either host supplies an empty <div id="qb-root"> and this fills it. */
const QB_MARKUP = "<div class=\"qb-topbar\">\n  <div class=\"qb-topbar-in\">\n    <a href=\"{{BACK}}\" class=\"back\">&larr; All banks</a>\n    <span class=\"title\" id=\"qb-title\">Loading\u2026</span>\n    <span class=\"qb-chip level\" id=\"qb-level\" hidden></span>\n    <span class=\"qb-chip\" id=\"qb-calc\" hidden></span>\n    <span class=\"qb-chip free\" id=\"qb-freechip\" hidden>Free sample</span>\n    <span class=\"spacer\"></span>\n    <button class=\"qb-filtertoggle\" id=\"qb-filters-toggle\" aria-expanded=\"false\" aria-controls=\"qb-side\">Filters &amp; topics</button>\n    <span class=\"counter\" id=\"qb-counter\"></span>\n  </div>\n</div>\n\n<main class=\"qb-app\">\n  <div class=\"qb-state\" id=\"qb-loading\">\n    <h2>Loading the bank\u2026</h2>\n    <p>One moment.</p>\n  </div>\n\n  <div class=\"qb-state\" id=\"qb-error\" hidden>\n    <h2>That bank could not be loaded.</h2>\n    <p id=\"qb-error-detail\">Pick one from the shelf and try again.</p>\n    <a href=\"question-banks.html\" class=\"btn btn-dark\" style=\"margin-top:14px;\">Back to all banks</a>\n  </div>\n\n  <div class=\"qb-layout\" id=\"qb-layout\" hidden>\n\n    <aside class=\"qb-side\" id=\"qb-side\">\n      <section id=\"qb-prog-section\">\n        <h4>Progress</h4>\n        <div class=\"qb-bar-label\"><span id=\"qb-prog-text\">0 of 0 done</span><b id=\"qb-prog-pct\">0%</b></div>\n        <div class=\"qb-bar\"><i id=\"qb-prog-bar\" style=\"width:0%\"></i></div>\n      </section>\n\n      <section id=\"qb-access-section\" hidden>\n        <div class=\"qb-access\">\n          <h4>One question is on the house</h4>\n          <p><b id=\"qb-access-count\">219 more</b> questions in this bank, each with its full worked solution.</p>\n          <a class=\"btn btn-primary btn-sm\" href=\"contact.html?package=question-bank\">Get access, $45/mo</a>\n          <a class=\"under\" href=\"pricing.html#calculator\">Free at 20+ pooled hours</a>\n        </div>\n      </section>\n\n      <section>\n        <h4 id=\"qb-topics-label\">Topics</h4>\n        <div class=\"qb-topiclist\" id=\"qb-topics\"></div>\n      </section>\n\n      <section id=\"qb-diff-section\">\n        <h4>Difficulty</h4>\n        <div class=\"qb-segment\" id=\"qb-difficulty\" role=\"group\" aria-label=\"Filter by difficulty\">\n          <button data-value=\"all\" aria-pressed=\"true\">All</button>\n          <button data-value=\"Easy\" aria-pressed=\"false\">Easy</button>\n          <button data-value=\"Medium\" aria-pressed=\"false\">Medium</button>\n          <button data-value=\"Hard\" aria-pressed=\"false\">Hard</button>\n        </div>\n      </section>\n\n      <section>\n        <h4>Show</h4>\n        <div class=\"qb-segment\" id=\"qb-status\" role=\"group\" aria-label=\"Filter by status\">\n          <button data-value=\"all\" aria-pressed=\"true\">All</button>\n          <button data-value=\"todo\" aria-pressed=\"false\">To do</button>\n          <button data-value=\"done\" aria-pressed=\"false\">Done</button>\n          <button data-value=\"saved\" aria-pressed=\"false\">Saved</button>\n        </div>\n      </section>\n\n      <section id=\"qb-sub-section\">\n        <h4>Subtopic</h4>\n        <select class=\"qb-select\" id=\"qb-subtopic\"><option value=\"all\">Every subtopic</option></select>\n      </section>\n\n      <section id=\"qb-term-section\">\n        <h4>Command term</h4>\n        <select class=\"qb-select\" id=\"qb-term\"><option value=\"all\">Every command term</option></select>\n      </section>\n\n      <section>\n        <button class=\"qb-railbtn\" id=\"qb-reset\" style=\"justify-content:center;\">Reset my progress</button>\n        <p class=\"qb-built\" id=\"qb-built\"></p>\n      </section>\n    </aside>\n\n    <div class=\"qb-card-wrap\">\n      <article class=\"qb-question\" id=\"qb-question\">\n        <div class=\"qb-qhead\">\n          <span class=\"qb-qnum\" id=\"qb-qnum\">Question 1</span>\n          <span class=\"qb-chip\" id=\"qb-qcalc\"></span>\n          <span class=\"qb-chip term\" id=\"qb-qterm\" hidden></span>\n          <span class=\"qb-chip variant\" id=\"qb-qvariant\" hidden></span>\n          <span class=\"spacer\"></span>\n          <span class=\"qb-diff\" id=\"qb-qdiff\"></span>\n        </div>\n        <div class=\"qb-qbody\">\n          <div id=\"qb-context\"></div>\n          <div class=\"qb-stem\" id=\"qb-stem\"></div>\n          <p class=\"qb-variants\" id=\"qb-variantnote\" hidden></p>\n          <ul class=\"qb-parts\" id=\"qb-partlist\" hidden></ul>\n          <ul class=\"qb-options\" id=\"qb-optionlist\" hidden></ul>\n\n          <div id=\"qb-locked\" hidden>\n            <div class=\"qb-redact\" aria-hidden=\"true\"><i></i><i></i><i></i></div>\n            <div class=\"qb-lockcta\">\n              <div class=\"icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"10\" width=\"16\" height=\"10\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3\"/></svg></div>\n              <h3>This one is behind the gate</h3>\n              <p id=\"qb-locked-lede\">Unlock the full bank to read it and its worked solution.</p>\n              <p class=\"facts\" id=\"qb-locked-facts\"></p>\n              <div class=\"actions\">\n                <a class=\"btn btn-primary\" href=\"contact.html?package=question-bank\">Get access, $45/mo</a>\n                <a class=\"btn btn-outline-dark\" href=\"pricing.html#calculator\">Free at 20+ pooled hours</a>\n                <button type=\"button\" class=\"link\" id=\"qb-to-sample\">Back to the free sample</button>\n              </div>\n            </div>\n          </div>\n\n          <div class=\"qb-scheme\" id=\"qb-scheme\" hidden>\n            <h4 id=\"qb-scheme-title\">Mark scheme</h4>\n            <div class=\"sol\" id=\"qb-scheme-body\"></div>\n            <p class=\"caveat\" id=\"qb-scheme-caveat\"></p>\n          </div>\n\n          <div class=\"qb-scheme qb-guide\" id=\"qb-guidance\" hidden>\n            <h4 id=\"qb-guide-title\">Where the marks go</h4>\n            <dl id=\"qb-guide-body\"></dl>\n            <p class=\"whose\" id=\"qb-guide-whose\"></p>\n          </div>\n\n          <div class=\"qb-scheme qb-notes\" id=\"qb-notes\" hidden>\n            <h4>My notes on this question</h4>\n            <p class=\"prompt\">Where did the mark go?</p>\n            <div class=\"qb-reasons\" id=\"qb-reasons\">\n              <button type=\"button\" data-reason=\"Concept\" aria-pressed=\"false\">Concept</button>\n              <button type=\"button\" data-reason=\"Algebra\" aria-pressed=\"false\">Algebra</button>\n              <button type=\"button\" data-reason=\"Notation\" aria-pressed=\"false\">Notation</button>\n              <button type=\"button\" data-reason=\"Interpretation\" aria-pressed=\"false\">Interpretation</button>\n              <button type=\"button\" data-reason=\"Time\" aria-pressed=\"false\">Time pressure</button>\n            </div>\n            <textarea id=\"qb-note-text\" placeholder=\"What exactly went wrong, in your own words?\"></textarea>\n            <p class=\"saved\" id=\"qb-note-saved\" hidden>Saved to this browser.</p>\n          </div>\n        </div>\n      </article>\n\n      <div class=\"qb-nav\">\n        <button id=\"qb-prev\">&larr; Previous</button>\n        <span class=\"spacer\"></span>\n        <button class=\"next\" id=\"qb-next\">Next &rarr;</button>\n      </div>\n\n      <div class=\"qb-grid-wrap\">\n        <h4 id=\"qb-grid-label\">Jump to a question</h4>\n        <div class=\"qb-grid\" id=\"qb-grid\"></div>\n      </div>\n    </div>\n\n    <aside class=\"qb-rail\">\n      <div class=\"qb-toolrow\">\n        <button id=\"qb-save\" class=\"save-btn\" aria-pressed=\"false\" title=\"Save this question\" aria-label=\"Save this question\">\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\"/></svg>\n        </button>\n        <button id=\"qb-done\" class=\"done-btn\" aria-pressed=\"false\" title=\"Mark as done\" aria-label=\"Mark as done\">\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8.5 12.2l2.4 2.4 4.6-4.8\"/></svg>\n        </button>\n      </div>\n\n      <a class=\"qb-railbtn unlock\" id=\"qb-unlock\" href=\"contact.html?package=question-bank\" hidden>\n        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"10\" width=\"16\" height=\"10\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3\"/></svg>\n        <span>Unlock this bank</span>\n      </a>\n\n      <button class=\"qb-railbtn\" id=\"qb-scheme-toggle\" aria-expanded=\"false\">\n        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5h16M4 10h16M4 15h10\"/></svg>\n        <span id=\"qb-scheme-label\">Mark Scheme</span>\n        <span class=\"hint\">S</span>\n      </button>\n\n      <button class=\"qb-railbtn\" id=\"qb-guide-toggle\" aria-expanded=\"false\">\n        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3l8 4.5v9L12 21l-8-4.5v-9z\"/><path d=\"M12 8v4M12 16h.01\"/></svg>\n        <span>Where Marks Go</span>\n        <span class=\"hint\">G</span>\n      </button>\n\n      <button class=\"qb-railbtn\" id=\"qb-notes-toggle\" aria-expanded=\"false\">\n        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 4h11l5 5v11H4z\"/><path d=\"M8 12h8M8 16h5\"/></svg>\n        <span>My Notes</span>\n        <span class=\"hint\">N</span>\n      </button>\n\n      <button class=\"qb-railbtn\" id=\"qb-random\">\n        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 7h4l8 10h4\"/><path d=\"M4 17h4l3-4\"/><path d=\"M17 4l3 3-3 3\"/><path d=\"M17 14l3 3-3 3\"/></svg>\n        <span>Shuffle</span>\n        <span class=\"hint\">R</span>\n      </button>\n\n      <div class=\"qb-reference\">\n        <button id=\"qb-about\">About this bank\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8h.01\"/></svg>\n        </button>\n        <a id=\"qb-syllabus-link\" href=\"#\" target=\"_blank\" rel=\"noopener\">Official subject page\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><path d=\"M14 4h6v6\"/><path d=\"M20 4l-9 9\"/><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/></svg>\n        </a>\n        <a href=\"contact.html?package=question-bank\">Stuck? Book a session\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><path d=\"M14 4h6v6\"/><path d=\"M20 4l-9 9\"/><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/></svg>\n        </a>\n      </div>\n    </aside>\n  </div>\n</main>\n\n<div class=\"qb-sheet\" id=\"qb-sheet\" hidden>\n  <div class=\"panel\">\n    <button class=\"close\" id=\"qb-sheet-close\" aria-label=\"Close\">&times;</button>\n    <h3 id=\"qb-sheet-title\">About this bank</h3>\n    <dl id=\"qb-sheet-body\"></dl>\n  </div>\n</div>";

function mountViewer() {
  const root = el("qb-root");
  if (!root || root.dataset.mounted) return;
  root.innerHTML = QB_MARKUP.replace("{{BACK}}", QB_BACK);
  root.dataset.mounted = "1";
}

/* ---------------- Saved state ----------------
   Progress is per browser. It is deliberately small and forgiving: a corrupt
   or unavailable store must never stop a student reading the questions. */
const QB_KEY = "oyib.questionbanks.v1";

function qbLoad() {
  try {
    return JSON.parse(localStorage.getItem(QB_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function qbSave(state) {
  try {
    localStorage.setItem(QB_KEY, JSON.stringify(state));
  } catch (e) {
    /* private browsing, or the quota is full — progress just will not persist */
  }
}

function qbBank(state, id) {
  if (!state[id]) state[id] = { done: [], saved: [], notes: {}, why: {} };
  const b = state[id];
  if (!Array.isArray(b.done)) b.done = [];
  if (!Array.isArray(b.saved)) b.saved = [];
  if (!b.notes || typeof b.notes !== "object") b.notes = {};
  // Added after the first version shipped, so it can be missing from a store
  // written by it.
  if (!b.why || typeof b.why !== "object") b.why = {};
  return b;
}

function qbToggle(list, n) {
  const i = list.indexOf(n);
  if (i === -1) list.push(n);
  else list.splice(i, 1);
  return i === -1;
}

/* ---------------- Small helpers ---------------- */
function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function dots(level) {
  let out = '<span class="dots">';
  for (let i = 1; i <= 5; i++) out += '<i class="' + (i <= level ? "on" : "") + '"></i>';
  return out + "</span>";
}

function marksLabel(n) { return n + (n === 1 ? " mark" : " marks"); }

function paceLabel(marks, pace) {
  const mins = Math.max(1, Math.round(marks * pace));
  return "~" + mins + " min";
}

/* ==========================================================================
   Page 1 — the shelf
   ========================================================================== */
function initShelf(shelf) {
  const empty = el("qb-shelf-empty");
  const filters = { subject: "all", level: "all" };
  let banks = [];

  fetch(QB_DATA + "index.json")
    .then((r) => r.json())
    .then((data) => { banks = data.banks; render(); })
    .catch(() => {
      shelf.innerHTML = "";
      empty.hidden = false;
      empty.textContent = "The bank index could not be loaded.";
    });

  document.querySelectorAll("#qb-filters .group").forEach((group) => {
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
    const state = qbLoad();
    const shown = banks.filter((b) =>
      (filters.subject === "all" || b.short === filters.subject) &&
      (filters.level === "all" || b.level === filters.level));

    empty.hidden = shown.length > 0;
    shelf.innerHTML = shown.map((b) => {
      const done = (state[b.id] && state[b.id].done ? state[b.id].done.length : 0);
      const pct = b.count ? Math.round((done / b.count) * 100) : 0;
      const topics = b.topics.slice(0, 6).map((t) =>
        "<li><b>" + esc(t.title) + "</b><span>" + t.count + "</span></li>").join("");
      const more = b.topics.length > 6
        ? '<li><b style="color:var(--ink-soft);font-weight:500;">+ ' +
          (b.topics.length - 6) + " more</b><span></span></li>"
        : "";
      const sampleLine = b.locked
        ? '<div class="sample-line">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>' +
            '<path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>' +
            "1 free sample <span>· " + (b.count - 1) + " unlock with access</span></div>"
        : "";
      const cta = b.locked
        ? "Read the free sample"
        : (done ? "Continue" : "Start practising");
      return '<a class="qb-card" href="' + QB_VIEW + "?bank=" + encodeURIComponent(b.id) + '">' +
        '<div class="meta">' +
          '<span class="qb-chip level">' + esc(b.level) + "</span>" +
          '<span class="qb-chip ' + (b.calculator ? "calc" : "nocalc") + '">' +
            (b.calculator ? "Calculator" : "No calculator") + "</span>" +
        "</div>" +
        "<h3>" + esc(b.subject) + "</h3>" +
        '<div class="paper">' + esc(b.paper) + "</div>" +
        '<div class="count">' + b.count + "<small>questions, all with solutions</small></div>" +
        sampleLine +
        (b.built ? '<div class="built">Updated ' +
          new Date(b.built + "T00:00:00").toLocaleDateString("en-GB",
            { month: "long", year: "numeric" }) + "</div>" : "") +
        '<ul class="topics">' + topics + more + "</ul>" +
        (!b.locked && done
          ? '<div class="qb-progress"><div class="qb-bar-label"><span>' + done +
            " done</span><b>" + pct + '%</b></div><div class="qb-bar"><i style="width:' +
            pct + '%"></i></div></div>'
          : "") +
        '<span class="btn btn-dark btn-block">' + cta + "</span>" +
        "</a>";
    }).join("");
  }
}

/* ==========================================================================
   Page 2 — the viewer
   ========================================================================== */
function initViewer() {
  const params = new URLSearchParams(location.search);
  const bankId = params.get("bank");
  if (!bankId || !/^[a-z0-9-]+$/.test(bankId)) return failViewer("No bank was named in the link.");

  Promise.all([
    fetch(QB_DATA + bankId + ".json")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    // Guidance is generic and small; a bank still opens without it.
    fetch(QB_DATA + "guidance.json").then((r) => r.json()).catch(() => null),
  ])
    .then(([bank, guide]) => {
      bank.guidance = (guide && guide.guidance) || {};
      return bank;
    })
    .catch(() => {
      failViewer("We could not find a bank called “" + bankId + "”.");
      return null;
    })
    // Deliberately outside the catch above: a fault in the viewer is not a
    // missing bank, and reporting it as one sends people hunting for the
    // wrong problem. Let it reach the console instead.
    .then((bank) => { if (bank) runViewer(bank, params); });
}

function failViewer(detail) {
  el("qb-loading").hidden = true;
  el("qb-layout").hidden = true;
  el("qb-error").hidden = false;
  el("qb-error-detail").textContent = detail;
}

function runViewer(bank, params) {
  const state = qbLoad();
  const mine = qbBank(state, bank.id);
  const isP3 = bank.family === "paper3";
  const isMcq = bank.questions.some((q) => q.options);
  // A gated bank ships one question in full and the rest as metadata only, so
  // "can this be read" is simply "did the file include a body".
  const gated = bank.locked === true;
  const readable = (q) => Boolean((q.body && q.body.length) || (q.parts && q.parts.length));
  const sample = bank.questions.find((q) => q.n === bank.sample) || bank.questions[0];

  const filters = { topic: "all", difficulty: "all", status: "all",
                    subtopic: "all", term: "all" };
  let visible = bank.questions.slice();
  let current = bank.questions[0];
  let chosen = null;           // the option this student clicked, this visit
  let schemeOpen = false;
  let notesOpen = false;
  let guideOpen = false;

  /* ---------- chrome ---------- */
  document.title = bank.short + " " + bank.level + " " + bank.paper +
    " Question Bank | Own Your IB";
  el("qb-title").textContent = bank.subject + " " + bank.level;
  const lvl = el("qb-level");
  lvl.textContent = bank.paper;
  lvl.hidden = false;
  const calc = el("qb-calc");
  calc.textContent = bank.calculator ? "Calculator" : "No calculator";
  calc.className = "qb-chip " + (bank.calculator ? "calc" : "nocalc");
  calc.hidden = false;

  const link = el("qb-syllabus-link");
  if (bank.links && bank.links.length) {
    link.href = bank.links[0];
  } else {
    link.hidden = true;
  }

  if (gated) {
    el("qb-prog-section").hidden = true;
    el("qb-access-section").hidden = false;
    el("qb-access-count").textContent = (bank.count - 1) + " more";
    // Done and saved need a bank you can work through; with one question they
    // are noise, and the reset button has nothing to reset.
    el("qb-status").parentElement.hidden = true;
    el("qb-reset").parentElement.hidden = true;
    el("qb-unlock").hidden = false;
  }

  el("qb-scheme-label").textContent = isMcq ? "Answer & Marking Points" : "Mark Scheme";
  el("qb-topics-label").textContent = isP3 ? "Strands" : "Topics";
  el("qb-grid-label").textContent = isP3 ? "Jump to an investigation" : "Jump to a question";
  // Paper 3 investigations are all extended work; a difficulty filter over
  // sixty questions that share one band would only ever return everything.
  if (isP3) el("qb-diff-section").hidden = true;

  el("qb-loading").hidden = true;
  el("qb-layout").hidden = false;

  /* ---------- sidebar ---------- */
  const topicsBox = el("qb-topics");
  topicsBox.innerHTML =
    '<button data-value="all" aria-pressed="true"><span>All ' +
      (isP3 ? "strands" : "topics") + "</span><em>" + bank.count + "</em></button>" +
    bank.topics.map((t, i) =>
      '<button data-value="' + i + '" aria-pressed="false"><span>' +
      esc(t.title) + "</span><em>" + t.count + "</em></button>").join("");

  const subSelect = el("qb-subtopic");
  const subs = [];
  bank.questions.forEach((q) => {
    if (q.subtopic && subs.indexOf(q.subtopic) === -1) subs.push(q.subtopic);
  });
  subs.sort();
  if (subs.length > 1) {
    subSelect.innerHTML = '<option value="all">Every subtopic</option>' +
      subs.map((s) => '<option value="' + esc(s) + '">' + esc(s) + "</option>").join("");
  } else {
    el("qb-sub-section").hidden = true;
  }

  const termSelect = el("qb-term");
  const allTerms = [];
  bank.questions.forEach((q) => {
    if (q.term && allTerms.indexOf(q.term) === -1) allTerms.push(q.term);
  });
  allTerms.sort();
  if (allTerms.length > 1) {
    termSelect.innerHTML = '<option value="all">Every command term</option>' +
      allTerms.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
  } else {
    el("qb-term-section").hidden = true;
  }

  if (bank.built) {
    el("qb-built").textContent = "Bank updated " + new Date(bank.built + "T00:00:00")
      .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function bindGroup(box, key, onSet) {
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || !btn.dataset.value) return;
      filters[key] = btn.dataset.value;
      box.querySelectorAll("button").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn)));
      onSet();
    });
  }
  bindGroup(topicsBox, "topic", applyFilters);
  bindGroup(el("qb-difficulty"), "difficulty", applyFilters);
  bindGroup(el("qb-status"), "status", applyFilters);
  subSelect.addEventListener("change", () => {
    filters.subtopic = subSelect.value;
    applyFilters();
  });
  termSelect.addEventListener("change", () => {
    filters.term = termSelect.value;
    applyFilters();
  });

  /* ---------- filtering ---------- */
  function applyFilters(keepCurrent) {
    visible = bank.questions.filter((q) => {
      if (filters.topic !== "all" && String(q.topic) !== filters.topic) return false;
      if (filters.difficulty !== "all" && q.label !== filters.difficulty) return false;
      if (filters.subtopic !== "all" && q.subtopic !== filters.subtopic) return false;
      if (filters.term !== "all" && q.term !== filters.term) return false;
      if (filters.status === "done" && mine.done.indexOf(q.n) === -1) return false;
      if (filters.status === "todo" && mine.done.indexOf(q.n) !== -1) return false;
      if (filters.status === "saved" && mine.saved.indexOf(q.n) === -1) return false;
      return true;
    });
    if (!visible.length) {
      // Never leave the student on an empty screen: the filter simply finds
      // nothing, so keep the question they were reading and say so.
      renderGrid();
      el("qb-counter").textContent = "No question matches those filters";
      return;
    }
    if (!keepCurrent || visible.indexOf(current) === -1) show(visible[0]);
    else { renderGrid(); renderCounter(); }
  }

  /* ---------- rendering one question ---------- */
  function show(q) {
    current = q;
    chosen = null;
    schemeOpen = false;
    notesOpen = false;

    el("qb-qnum").textContent = (isP3 ? "Investigation " : "Question ") + q.n;

    const head = el("qb-qcalc");
    head.textContent = marksLabel(q.marks) + " · " + paceLabel(q.marks, bank.pace);
    head.className = "qb-chip";

    const diff = el("qb-qdiff");
    diff.dataset.band = q.label;
    // The maths banks name their own tiers; keep that word and let the dots
    // carry the Easy/Medium/Hard band the sciences are graded on.
    diff.innerHTML = (q.tier || q.label) + dots(q.level);
    diff.title = q.tier ? q.tier + " — " + q.label : q.label;

    const termChip = el("qb-qterm");
    termChip.hidden = !q.term;
    if (q.term) termChip.textContent = q.term;

    const varChip = el("qb-qvariant");
    varChip.hidden = !q.variant || q.variants < 2;
    if (!varChip.hidden) varChip.textContent = "Variant " + q.variant + " of " + q.variants;

    const topic = bank.topics[q.topic];
    const bits = [];
    if (topic) bits.push(esc(topic.title));
    if (q.subtopic && (!topic || q.subtopic !== topic.title)) bits.push(esc(q.subtopic));
    if (q.code) bits.unshift(esc(q.code));
    if (q.qtype) bits.push(esc(q.qtype));
    if (isP3 && q.set) bits.push("Practice set " + q.set + " · Investigation " + q.slot);
    el("qb-context").innerHTML = bits.length
      ? '<div class="eyebrow" style="margin-bottom:16px;">' + bits.join(" · ") + "</div>"
      : "";

    const open = readable(q);
    el("qb-freechip").hidden = !(gated && open);
    el("qb-locked").hidden = open;

    // Siblings share the task and differ in their numbers. Naming them turns
    // what reads as a repeat into what it is: the same investigation to drill
    // again, with a different answer at the end of it.
    const note = el("qb-variantnote");
    const siblings = q.variants > 1
      ? bank.questions.filter((x) => x.title === q.title && x.n !== q.n)
      : [];
    note.hidden = siblings.length === 0;
    if (siblings.length) {
      note.innerHTML = "<b>Same investigation, different numbers.</b> " +
        "“" + esc(q.title) + "” is set " + q.variants + " times over with new " +
        "parameters and a different answer each time: " +
        siblings.map((x) => '<button type="button" data-goto="' + x.n + '">#' +
          x.n + "</button>").join("") +
        ". Work one now and another in a fortnight.";
    }

    let stem = "";
    if (q.title) stem += "<h3>" + esc(q.title) + "</h3>";
    if (open) stem += (q.body || []).map((p) => "<p>" + p + "</p>").join("");
    el("qb-stem").innerHTML = stem;

    if (!open) {
      const facts = [marksLabel(q.marks), q.label];
      if (q.subtopic) facts.unshift(q.subtopic);
      el("qb-locked-facts").innerHTML =
        "<b>" + (isP3 ? "Investigation " : "Question ") + q.n + " of " + bank.count +
        "</b> · " + facts.map(esc).join(" · ");
      el("qb-locked-lede").textContent = "Question " + bank.sample +
        " is free to read in full. Unlock the bank for the other " +
        (bank.count - 1) + ", each with its worked solution.";
    }

    const parts = el("qb-partlist");
    if (open && q.parts && q.parts.length) {
      parts.innerHTML = q.parts.map((p) =>
        '<li><span class="lab">(' + p.label + ')</span><span>' + p.html +
        '</span><span class="mk">' + (p.marks ? "[" + p.marks + "]" : "") + "</span></li>").join("");
      parts.hidden = false;
    } else {
      // Emptied, not just hidden. These lists carry paid content, and a single
      // CSS mistake should not be all that stands between it and the page.
      parts.innerHTML = "";
      parts.hidden = true;
    }

    const opts = el("qb-optionlist");
    if (open && q.options && q.options.length) {
      opts.innerHTML = q.options.map((o) =>
        '<button type="button" data-key="' + o.k + '"><span class="key">' + o.k +
        '</span><span>' + o.html + "</span></button>").join("");
      opts.hidden = false;
    } else {
      opts.innerHTML = "";
      opts.hidden = true;
    }

    renderScheme();
    renderGuidance();
    renderNotes();
    renderTools();
    renderGrid();
    renderCounter();

    const url = new URL(location.href);
    url.searchParams.set("bank", bank.id);
    url.searchParams.set("q", q.n);
    history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderScheme() {
    const q = current;
    const box = el("qb-scheme");
    box.hidden = !schemeOpen;
    // Nothing to reveal on a question whose text never arrived.
    const open = readable(q);
    el("qb-scheme-toggle").disabled = !open;
    el("qb-notes-toggle").disabled = !open;
    if (!open) {
      box.hidden = true;
      el("qb-scheme-body").innerHTML = "";
      el("qb-notes").hidden = true;
      return;
    }
    el("qb-scheme-toggle").setAttribute("aria-expanded", String(schemeOpen));
    if (!schemeOpen) return;

    el("qb-scheme-title").textContent = q.answer
      ? "Answer: " + q.answer
      : (isMcq ? "Answer & marking points" : "Worked solution");

    let html = "";
    if (q.solparts && q.solparts.length) {
      html += '<ul class="qb-parts">' + q.solparts.map((p) =>
        '<li><span class="lab">(' + p.label + ')</span><span>' + p.html +
        '</span><span class="mk">' + (p.marks ? "[" + p.marks + "]" : "") + "</span></li>")
        .join("") + "</ul>";
    }
    html += q.solution.map((p) => "<p>" + p + "</p>").join("");
    el("qb-scheme-body").innerHTML = html;
    el("qb-scheme-caveat").textContent = isP3 || bank.family === "maths"
      ? "Equivalent valid methods earn the same credit. Mark the reasoning you actually wrote down, not the reasoning you intended."
      : "Marking points are practice allocations, not official IB marking notes.";
  }

  function renderGuidance() {
    const q = current;
    const box = el("qb-guidance");
    const g = q.term && bank.guidance[q.term];
    el("qb-guide-toggle").disabled = !g;
    box.hidden = !(guideOpen && g);
    el("qb-guide-toggle").setAttribute("aria-expanded", String(guideOpen && !!g));
    if (box.hidden) return;
    el("qb-guide-title").textContent = (q.termOfficial ? "Command term: " : "This asks you to ") + q.term;
    el("qb-guide-body").innerHTML =
      '<div class="row earn"><dt>Earns</dt><dd>' + esc(g.earns) + "</dd></div>" +
      '<div class="row lose"><dt>Loses</dt><dd>' + esc(g.loses) + "</dd></div>";
    el("qb-guide-whose").textContent = q.termOfficial
      ? "Our guidance on how " + q.term + " questions are marked, not official IB marking notes."
      : "“" + q.term + "” is the question's own instruction rather than an IB command term. Guidance is ours.";
  }

  function renderNotes() {
    const box = el("qb-notes");
    box.hidden = !notesOpen;
    el("qb-notes-toggle").setAttribute("aria-expanded", String(notesOpen));
    if (notesOpen) {
      el("qb-note-text").value = mine.notes[current.n] || "";
      const why = mine.why[current.n] || [];
      el("qb-reasons").querySelectorAll("button").forEach((b) =>
        b.setAttribute("aria-pressed", String(why.indexOf(b.dataset.reason) !== -1)));
      el("qb-note-saved").hidden = true;
    }
  }

  function renderTools() {
    const open = readable(current);
    el("qb-save").disabled = !open;
    el("qb-done").disabled = !open;
    el("qb-save").setAttribute("aria-pressed",
      String(mine.saved.indexOf(current.n) !== -1));
    el("qb-done").setAttribute("aria-pressed",
      String(mine.done.indexOf(current.n) !== -1));
  }

  function renderCounter() {
    const i = visible.indexOf(current);
    const pos = i === -1 ? "Filtered out" : (i + 1) + " of " + visible.length;
    el("qb-counter").innerHTML = gated
      ? "<b>" + pos + "</b> shown · 1 free, " + (bank.count - 1) + " locked"
      : "<b>" + pos + "</b> shown · " + mine.done.length + " of " + bank.count + " done";

    if (!gated) {
      const pct = bank.count ? Math.round((mine.done.length / bank.count) * 100) : 0;
      el("qb-prog-text").textContent = mine.done.length + " of " + bank.count + " done";
      el("qb-prog-pct").textContent = pct + "%";
      el("qb-prog-bar").style.width = pct + "%";
    }

    el("qb-prev").disabled = i <= 0;
    el("qb-next").disabled = i === -1 || i >= visible.length - 1;
  }

  function renderGrid() {
    el("qb-grid").innerHTML = visible.map((q) => {
      const cls = [];
      if (q === current) cls.push("current");
      if (gated) cls.push(readable(q) ? "sample" : "locked");
      if (mine.done.indexOf(q.n) !== -1) cls.push("done");
      if (mine.saved.indexOf(q.n) !== -1) cls.push("marked");
      return '<button class="' + cls.join(" ") + '" data-n="' + q.n + '">' + q.n + "</button>";
    }).join("");
  }

  /* ---------- interactions ---------- */
  el("qb-optionlist").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || chosen) return;
    chosen = btn.dataset.key;
    el("qb-optionlist").querySelectorAll("button").forEach((b) => {
      b.disabled = true;
      const key = b.dataset.key;
      if (key === current.answer) {
        b.classList.add("right");
        b.insertAdjacentHTML("beforeend", '<span class="verdict">Correct</span>');
      } else if (key === chosen) {
        b.classList.add("wrong");
        b.insertAdjacentHTML("beforeend", '<span class="verdict">Your answer</span>');
      }
    });
    schemeOpen = true;
    renderScheme();
    if (chosen === current.answer && mine.done.indexOf(current.n) === -1) {
      mine.done.push(current.n);
      qbSave(state);
      renderTools();
      renderGrid();
      renderCounter();
    }
  });

  el("qb-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const q = bank.questions.find((x) => x.n === Number(btn.dataset.n));
    if (q) show(q);
  });

  el("qb-to-sample").addEventListener("click", () => show(sample));

  el("qb-prev").addEventListener("click", () => step(-1));
  el("qb-next").addEventListener("click", () => step(1));

  function step(d) {
    const i = visible.indexOf(current);
    if (i === -1) return;
    const next = visible[i + d];
    if (next) show(next);
  }

  el("qb-scheme-toggle").addEventListener("click", () => {
    schemeOpen = !schemeOpen;
    renderScheme();
    if (schemeOpen) el("qb-scheme").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  el("qb-guide-toggle").addEventListener("click", () => {
    guideOpen = !guideOpen;
    renderGuidance();
    if (guideOpen) el("qb-guidance").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  el("qb-notes-toggle").addEventListener("click", () => {
    notesOpen = !notesOpen;
    renderNotes();
    if (notesOpen) el("qb-note-text").focus();
  });

  // Jump to a sibling investigation from the variants note.
  el("qb-variantnote").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-goto]");
    if (!btn) return;
    const q = bank.questions.find((x) => x.n === Number(btn.dataset.goto));
    if (q) show(q);
  });

  let noteTimer = null;
  el("qb-note-text").addEventListener("input", (e) => {
    const text = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      if (text.trim()) mine.notes[current.n] = text;
      else delete mine.notes[current.n];
      qbSave(state);
      el("qb-note-saved").hidden = false;
    }, 400);
  });

  // The banks' own taxonomy for a lost mark: concept, algebra, notation,
  // interpretation or time. Recording which is the habit their "how to use"
  // pages ask for, and it is far quicker to tap than to write out.
  el("qb-reasons").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-reason]");
    if (!btn) return;
    const why = mine.why[current.n] || (mine.why[current.n] = []);
    const on = qbToggle(why, btn.dataset.reason);
    if (!why.length) delete mine.why[current.n];
    btn.setAttribute("aria-pressed", String(on));
    qbSave(state);
    el("qb-note-saved").hidden = false;
  });

  el("qb-save").addEventListener("click", () => {
    qbToggle(mine.saved, current.n);
    qbSave(state);
    renderTools();
    renderGrid();
    if (filters.status === "saved") applyFilters(true);
  });

  el("qb-done").addEventListener("click", () => {
    qbToggle(mine.done, current.n);
    qbSave(state);
    renderTools();
    renderGrid();
    renderCounter();
    if (filters.status !== "all") applyFilters(true);
  });

  el("qb-random").addEventListener("click", () => {
    const pool = gated ? visible.filter(readable) : visible;
    if (pool.length < 2 && pool[0] === current) return;
    let pick = current;
    while (pick === current && pool.length) {
      pick = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length === 1) break;
    }
    show(pick);
  });

  el("qb-reset").addEventListener("click", () => {
    if (!confirm("Clear your progress, saved questions and notes for this bank?")) return;
    mine.done = [];
    mine.saved = [];
    mine.notes = {};
    mine.why = {};
    qbSave(state);
    applyFilters(true);
    renderTools();
    renderNotes();
  });

  /* In the one-column layout the sidebar is collapsed behind this, so the
     question stays the first thing on screen. */
  const filterToggle = el("qb-filters-toggle");
  filterToggle.addEventListener("click", () => {
    const open = el("qb-side").classList.toggle("open");
    filterToggle.setAttribute("aria-expanded", String(open));
  });

  /* ---------- about sheet ---------- */
  const sheet = el("qb-sheet");
  el("qb-about").addEventListener("click", () => {
    const rows = [];
    if (bank.format) rows.push(["The examination", bank.format]);
    const termCount = new Set(bank.questions.filter((q) => q.term)
      .map((q) => q.term)).size;
    const tagged = bank.questions.filter((q) => q.term).length;
    rows.push(["Tagging", bank.count + " questions, each carrying its topic" +
      (bank.questions.some((q) => q.subtopic) ? ", subtopic" : "") +
      ", marks and difficulty. " + tagged + " of them (" +
      Math.round((tagged / bank.count) * 100) + "%) also carry a command term, " +
      termCount + " distinct across the bank."]);
    if (bank.templates && bank.templates < bank.count) {
      rows.push(["Investigations and variants", bank.count +
        " investigations built from " + bank.templates + " tasks, each set " +
        Math.round(bank.count / bank.templates) + " times with different " +
        "parameters. Every variant has its own numbers, its own working and " +
        "its own answer — the same investigation is worth doing more than once."]);
    }
    if (bank.howTo) rows.push(["How to use this bank", bank.howTo]);
    if (bank.steps && bank.steps.length) {
      rows.push(["A working routine", bank.steps.map((s) =>
        s.n + ". " + s.action + " — " + s.text).join("<br>")]);
    }
    if (bank.syllabus) rows.push(["Syllabus", bank.syllabus]);
    if (bank.note) rows.push(["Alignment", bank.note]);
    if (bank.disclaimer) rows.push(["Authorship", bank.disclaimer]);
    if (bank.built) {
      rows.push(["Last updated", "This bank was built from its source on " +
        new Date(bank.built + "T00:00:00").toLocaleDateString("en-GB",
          { day: "numeric", month: "long", year: "numeric" }) + "."]);
    }
    rows.push(["Where the marks go", "Every question carrying a command term " +
      "also carries our guidance on what earns the marks on that kind of " +
      "question and what usually loses them. It is our own exam-technique " +
      "guidance, not official IB marking notes."]);
    if (bank.links && bank.links.length) {
      rows.push(["Official sources", bank.links.map((u) =>
        '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + "</a>")
        .join("<br>")]);
    }
    el("qb-sheet-title").textContent = bank.subject + " " + bank.level + " · " + bank.paper;
    el("qb-sheet-body").innerHTML = rows.map((r) =>
      "<dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd>").join("");
    sheet.hidden = false;
  });
  el("qb-sheet-close").addEventListener("click", () => { sheet.hidden = true; });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.hidden = true; });

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "Escape") { sheet.hidden = true; return; }
    if (e.key === "ArrowLeft") { step(-1); return; }
    if (e.key === "ArrowRight") { step(1); return; }
    const k = e.key.toLowerCase();
    if (k === "s") el("qb-scheme-toggle").click();
    else if (k === "n") el("qb-notes-toggle").click();
    else if (k === "g") el("qb-guide-toggle").click();
    else if (k === "r") el("qb-random").click();
  });

  /* ---------- open on the requested question ---------- */
  const want = Number(params.get("q"));
  const start = bank.questions.find((q) => q.n === want) ||
    (gated ? sample : bank.questions[0]);
  show(start);
}

/* ==========================================================================
   The samples strip, on the resources page
   Every bank's free question, linked straight into the viewer at that question.
   ========================================================================== */
function initSamples(strip) {
  fetch(QB_DATA + "index.json")
    .then((r) => r.json())
    .then((data) => {
      strip.innerHTML = data.banks.map((b) =>
        '<a href="' + QB_VIEW + "?bank=" + encodeURIComponent(b.id) +
          "&q=" + b.sample + '">' +
          "<em>Free sample</em>" +
          "<b>" + esc(b.short) + " " + esc(b.level) + "</b>" +
          "<span>" + esc(b.paper) + " · question " + b.sample +
          " of " + b.count + "</span>" +
        "</a>").join("");
    })
    .catch(() => {
      strip.innerHTML = '<a href="question-banks.html"><b>Browse the banks</b>' +
        "<span>The sample list could not be loaded.</span></a>";
    });
}

/* ---------------- boot ---------------- */

/* The marketing pages load this with a plain <script> at the end of the body,
 * so DOMContentLoaded is still ahead. The portal injects it after hydration,
 * by which time that event has long since fired and a listener for it would
 * never run — hence the readyState check rather than the listener alone. */
function qbBoot() {
  qbReadConfig();
  const shelf = el("qb-shelf");
  const strip = el("qb-samples");
  if (shelf) initShelf(shelf);
  else if (strip) initSamples(strip);
  else if (el("qb-root")) {
    mountViewer();
    initViewer();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", qbBoot);
} else {
  qbBoot();
}
