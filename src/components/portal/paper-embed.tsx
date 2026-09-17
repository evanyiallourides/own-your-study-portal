import "@/styles/qbank.css";
import "@/styles/qbank-embed.css";

/**
 * The mock-paper viewer, mounted inside the portal.
 *
 * The same arrangement as `QuestionBankEmbed`: one implementation of the paper
 * — its clock, its marking and its running total — lives in `papers.js` on the
 * marketing site, and a copy of the script is served from `public/`. The portal
 * supplies an empty container and points it at `/api/papers/`, which checks the
 * signed-in student's access before answering.
 */
export function PaperEmbed({
  mode,
  backHref,
  viewHref,
}: {
  mode: "shelf" | "paper";
  backHref?: string;
  viewHref?: string;
}) {
    const config = {
    "data-pp-base": "/api/papers/",
    ...(viewHref ? { "data-pp-view": viewHref } : {}),
    ...(backHref ? { "data-pp-back": backHref } : {}),
  };

  // Children of these divs belong to the viewer, not to React.
  const opaque = { dangerouslySetInnerHTML: { __html: "" } };

  return (
    <div className="qb-embed">
      {mode === "shelf" ? (
        <>
          <div className="pp-shelf" id="pp-shelf" {...config} {...opaque} />
          <div className="qb-empty" id="pp-shelf-empty" hidden />
        </>
      ) : (
        <div className="pp-app" style={{ padding: 0 }}>
          <div id="pp-root" {...config} {...opaque} />
        </div>
      )}
    </div>
  );
}
