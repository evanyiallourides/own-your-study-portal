import Link from "next/link";

import { LinkIcon } from "@/components/ui/icons";
import { Badge, NoteList, cx } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import type { ClassBoard, StudyPlan, TutoringHours } from "@/lib/types";

/* ==========================================================================
   A student's standing records, for reading
   --------------------------------------------------------------------------
   Server components only. The editing halves are in student-records-forms.tsx
   and are rendered beside these on the tutor and administrator pages.
   ========================================================================== */

/** "12", "12.5", "−3". Minutes in, hours out, never more than one decimal. */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return text.replace("-", "−");
}

export function hoursLabel(minutes: number): string {
  const n = Math.abs(Math.round((minutes / 60) * 10) / 10);
  return `${formatHours(minutes)} ${n === 1 ? "hour" : "hours"}`;
}

/** Remaining hours, with what was bought, taught and booked beneath. */
export function HoursSummary({ hours, compact = false }: { hours: TutoringHours; compact?: boolean }) {
  const over = hours.remainingMinutes < 0;
  const nothingBought = hours.purchasedMinutes === 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <p
          className={cx(
            "font-display font-semibold tabular-nums",
            compact ? "text-3xl" : "text-4xl",
            over ? "text-warning" : "text-ink",
          )}
        >
          {formatHours(Math.max(hours.remainingMinutes, 0))}
        </p>
        <p className="text-sm text-ink-500">
          {Math.abs(hours.remainingMinutes) === 60 ? "hour" : "hours"} left to book
        </p>
      </div>

      {nothingBought ? (
        <p className="mt-2 text-sm text-ink-500">No hours on this account yet.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-ink-300">Bought</dt>
            <dd className="font-semibold tabular-nums text-ink-700">{formatHours(hours.purchasedMinutes)}</dd>
          </div>
          <div>
            <dt className="text-ink-300">Taught</dt>
            <dd className="font-semibold tabular-nums text-ink-700">{formatHours(hours.usedMinutes)}</dd>
          </div>
          <div>
            <dt className="text-ink-300">Booked</dt>
            <dd className="font-semibold tabular-nums text-ink-700">{formatHours(hours.bookedMinutes)}</dd>
          </div>
        </dl>
      )}

      {over ? (
        <p className="mt-3 text-sm text-warning">
          {hoursLabel(-hours.remainingMinutes)} booked beyond what has been bought.
        </p>
      ) : null}
    </div>
  );
}

const ENTRY_REASON: Record<TutoringHours["entries"][number]["reason"], string> = {
  purchase: "Bought",
  admin_grant: "Added",
  refund: "Returned on a refund",
  correction: "Corrected",
};

export function HoursLedger({ hours, limit = 8 }: { hours: TutoringHours; limit?: number }) {
  if (hours.entries.length === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">Ledger</p>
      <ul className="space-y-1.5 text-sm">
        {hours.entries.slice(0, limit).map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-2">
            <span
              className={cx(
                "w-14 shrink-0 text-right font-semibold tabular-nums",
                entry.minutes > 0 ? "text-success" : "text-ink-500",
              )}
            >
              {entry.minutes > 0 ? "+" : ""}
              {formatHours(entry.minutes)}h
            </span>
            <span className="text-ink-700">{entry.note ?? ENTRY_REASON[entry.reason]}</span>
            <span className="text-xs text-ink-300">{formatDate(entry.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which service a board link points at, for the badge. Purely cosmetic. */
export function boardService(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Board";
  }
  const known: [RegExp, string][] = [
    [/miro\.com$/, "Miro"],
    [/excalidraw\.com$/, "Excalidraw"],
    [/bitpaper\.io$/, "Bitpaper"],
    [/(onenote|office|sharepoint|live)\.com$/, "OneNote"],
    [/jamboard\.google\.com$/, "Jamboard"],
    [/classroom\.google\.com$/, "Google Classroom"],
    [/canva\.com$/, "Canva"],
    [/figma\.com$/, "FigJam"],
    [/whiteboard\.(microsoft|office)\.com$/, "Whiteboard"],
    [/tldraw\.com$/, "tldraw"],
    [/padlet\.com$/, "Padlet"],
    [/notion\.(so|site)$/, "Notion"],
  ];
  return known.find(([pattern]) => pattern.test(host))?.[1] ?? host;
}

/** The boards as links that open in a new tab. `renderAction` adds a remove button for editors. */
export function ClassBoardList({
  boards,
  emptyText = "No class boards linked yet.",
  renderAction,
}: {
  boards: ClassBoard[];
  emptyText?: string;
  renderAction?: (board: ClassBoard) => React.ReactNode;
}) {
  if (boards.length === 0) return <p className="text-sm text-ink-500">{emptyText}</p>;
  return (
    <ul className="divide-y divide-rule">
      {boards.map((board) => (
        <li key={board.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <a
            href={board.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-w-0 items-center gap-3"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
              <LinkIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink group-hover:text-accent group-hover:underline">
                {board.label}
              </span>
              <span className="block truncate text-xs text-ink-500">
                {board.subjectName ?? "All subjects"} · {boardService(board.url)}
              </span>
            </span>
          </a>
          {renderAction ? renderAction(board) : null}
        </li>
      ))}
    </ul>
  );
}

/** The plan, read-only. Used on the dashboard, the plan page and the printable document. */
export function StudyPlanView({
  plan,
  tutorNames,
  emptyText = "Your tutor has not written a study plan yet.",
  showReview = true,
}: {
  plan: StudyPlan | null;
  tutorNames?: string[];
  emptyText?: string;
  showReview?: boolean;
}) {
  if (!plan) return <p className="text-sm text-ink-500">{emptyText}</p>;
  return (
    <div className="space-y-6">
      {showReview && plan.review ? (
        <section>
          <h3 className="font-display text-lg font-semibold">Where things stand</h3>
          <div className="mt-2 max-w-[68ch] space-y-3 leading-relaxed text-ink-700">
            {plan.review.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}
      {plan.goals.length > 0 ? (
        <section>
          <h3 className="font-display text-lg font-semibold">Goals</h3>
          <div className="mt-2">
            <NoteList items={plan.goals} tone="accent" />
          </div>
        </section>
      ) : null}
      {plan.focusAreas.length > 0 ? (
        <section>
          <h3 className="font-display text-lg font-semibold">Focus for the coming weeks</h3>
          <div className="mt-2">
            <NoteList items={plan.focusAreas} tone="warning" />
          </div>
        </section>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
        <span>Updated {formatDate(plan.updatedAt)}</span>
        {tutorNames && tutorNames.length > 0 ? <span>· {tutorNames.join(", ")}</span> : null}
        {plan.nextReviewOn ? (
          <Badge tone="info">Next review {formatDate(`${plan.nextReviewOn}T12:00:00Z`)}</Badge>
        ) : null}
      </p>
    </div>
  );
}

/** A small "open the document" link, styled like the other section actions. */
export function DocumentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm font-semibold text-accent hover:underline">
      {children}
    </Link>
  );
}
