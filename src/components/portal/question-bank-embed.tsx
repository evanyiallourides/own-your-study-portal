import "@/styles/qbank.css";
import "@/styles/qbank-embed.css";

/**
 * The question bank viewer, mounted inside the portal.
 *
 * There is one viewer. It lives on the marketing site as `qbank.js`, and a copy
 * of the script is served from `public/question-bank/`. It renders its own
 * markup into an empty `<div id="qb-root">` (or fills `#qb-shelf`), which is
 * what lets it be embedded here without a second implementation of seven
 * hundred lines of filtering, marking and progress logic that would then have
 * to be kept in step.
 *
 * What differs inside the portal is only where the data comes from:
 * `/api/question-banks/`, which answers nothing until it has checked the
 * signed-in student's access. The viewer neither knows nor needs to know — a
 * bank it cannot fetch is a bank it does not show.
 *
 * The three data attributes are how it is told, rather than globals set by an
 * inline script: nothing has to run before the script loads, so there is no
 * ordering to get wrong.
 */
export function QuestionBankEmbed({
  mode,
  backHref,
  viewHref,
}: {
  mode: "shelf" | "viewer";
  backHref?: string;
  viewHref?: string;
}) {
  const config = {
    "data-qb-base": "/api/question-banks/",
    ...(viewHref ? { "data-qb-view": viewHref } : {}),
    ...(backHref ? { "data-qb-back": backHref } : {}),
  };

  return (
    <div className="qb-embed">
      {mode === "shelf" ? (
        <>
          <div className="qb-shelf" id="qb-shelf" {...config} />
          <div className="qb-empty" id="qb-shelf-empty" hidden />
        </>
      ) : (
        <div id="qb-root" {...config} />
      )}

      {/* A plain deferred script, not next/script.
        *
        * The viewer is vanilla JavaScript that needs no orchestration, and
        * next/script's afterInteractive strategy injects the tag from the
        * client bundle — so a page whose hydration is slow or fails shows an
        * empty shelf and no error. `defer` runs it after parsing without
        * depending on React at all. */}
      <script src="/question-bank/qbank.js" defer />
    </div>
  );
}
