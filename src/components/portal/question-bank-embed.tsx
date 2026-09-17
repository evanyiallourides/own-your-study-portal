"use client";

import "@/styles/qbank.css";
import "@/styles/qbank-embed.css";

import { useVanillaViewer } from "@/components/portal/use-vanilla-viewer";

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
 *
 * The script is loaded and booted by useVanillaViewer rather than by a
 * `<script>` in this markup. That comment is worth reading before changing it
 * back — the markup version rendered an empty shelf on every route into this
 * page, in two different ways.
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
  useVanillaViewer("/question-bank/qbank.js", "qbBoot");

  const config = {
    "data-qb-base": "/api/question-banks/",
    ...(viewHref ? { "data-qb-view": viewHref } : {}),
    ...(backHref ? { "data-qb-back": backHref } : {}),
  };

  // Children of these divs belong to the viewer, not to React.
  const opaque = { dangerouslySetInnerHTML: { __html: "" } };

  return (
    <div className="qb-embed">
      {mode === "shelf" ? (
        <>
          <div className="qb-shelf" id="qb-shelf" {...config} {...opaque} />
          <div className="qb-empty" id="qb-shelf-empty" hidden />
        </>
      ) : (
        <div id="qb-root" {...config} {...opaque} />
      )}
    </div>
  );
}
