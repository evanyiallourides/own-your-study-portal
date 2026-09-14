/* ==========================================================================
   Demo store
   --------------------------------------------------------------------------
   Module-level mutable copies of the demo seed. Edits made while clicking
   around — publishing a lesson, ticking off homework — persist for the life of
   the server process and reset on restart, which is the right lifetime for a
   sandbox. Nothing here is ever used when Supabase is configured.
   ========================================================================== */

import {
  DEMO_ASSIGNMENTS,
  DEMO_LESSONS,
  DEMO_ORDERS,
  LIVE_LESSON_IDS,
  anchorLive,
  DEMO_PARENTS,
  DEMO_PARENT_STUDENTS,
  DEMO_PROFILES,
  DEMO_STUDENTS,
  DEMO_STUDENT_SUBJECTS,
  DEMO_SUBJECTS,
  DEMO_TUTORS,
} from "@/lib/demo/dataset";
import {
  DEMO_FILES,
  DEMO_HOMEWORK,
  DEMO_NOTES,
  DEMO_NOTIFICATIONS,
  DEMO_PROGRESS,
  DEMO_TRANSCRIPTS,
} from "@/lib/demo/content";
import { calendarDayDelta, zonedParts } from "@/lib/timezone";
import type {
  Order,
  AppSettings,
  Assignment,
  HomeworkItem,
  Lesson,
  LessonFile,
  LessonNotesForTutor,
  Notification,
  Parent,
  Profile,
  Student,
  Subject,
  TopicProgress,
  Transcript,
  Tutor,
} from "@/lib/types";

const clone = <T>(value: T): T => structuredClone(value);

interface DemoState {
  profiles: Profile[];
  students: Student[];
  tutors: Tutor[];
  parents: Parent[];
  parentStudents: { parentId: string; studentId: string }[];
  subjects: Subject[];
  studentSubjects: { id: string; studentId: string; subjectId: string; active: boolean }[];
  assignments: Assignment[];
  lessons: Lesson[];
  notes: LessonNotesForTutor[];
  transcripts: Transcript[];
  files: LessonFile[];
  homework: HomeworkItem[];
  progress: TopicProgress[];
  notifications: Notification[];
  /** Question bank subscriptions, keyed by student id. */
  questionBankAccess: Record<
    string,
    { granted: boolean; expiresAt: string | null; note: string | null; grantedAt: string }
  >;
  /** Seeded to cover every state the orders screen can render. */
  orders: Order[];
  settings: AppSettings;
  /** The calendar day the dates above were resolved against. */
  seededOn: string;
}

function seed(): DemoState {
  return {
    seededOn: calendarDay(new Date()),
    profiles: clone(DEMO_PROFILES),
    students: clone(DEMO_STUDENTS),
    tutors: clone(DEMO_TUTORS),
    parents: clone(DEMO_PARENTS),
    parentStudents: clone(DEMO_PARENT_STUDENTS),
    subjects: clone(DEMO_SUBJECTS),
    studentSubjects: clone(DEMO_STUDENT_SUBJECTS),
    assignments: clone(DEMO_ASSIGNMENTS),
    lessons: clone(DEMO_LESSONS),
    notes: clone(DEMO_NOTES),
    transcripts: clone(DEMO_TRANSCRIPTS),
    files: clone(DEMO_FILES),
    homework: clone(DEMO_HOMEWORK),
    progress: clone(DEMO_PROGRESS),
    notifications: clone(DEMO_NOTIFICATIONS),
    // Empty on purpose: the demo student earns access through pooled hours,
    // which exercises the more interesting of the two routes in.
    questionBankAccess: {},
    orders: clone(DEMO_ORDERS),
    settings: {
      notetakerEnabledGlobally: true,
      notetakerDisplayName: "Own Your Study AI Notetaker",
      requireGuardianConsentUnder18: true,
      transcriptRetentionDays: 365,
      mediaRetentionHours: 24,
      questionBankFreeHours: 20,
    },
  };
}

/* Next reloads modules between requests in development, which would otherwise
   throw away every demo edit on each keystroke. Parking the state on
   globalThis keeps a session's changes alive across hot reloads. */
const globalForDemo = globalThis as unknown as { __oysDemoState?: DemoState };

export const demoState: DemoState = globalForDemo.__oysDemoState ?? seed();
if (!globalForDemo.__oysDemoState) globalForDemo.__oysDemoState = demoState;

/**
 * Keep the demo dataset anchored to the actual date.
 *
 * Every date in the demo is relative — "two days ago", "today at 16:00" — and
 * resolved once, when the dataset module is first evaluated. The state is then
 * parked on globalThis so a session's edits survive hot reloads, which means
 * those dates stay where they were put for as long as the process lives.
 *
 * On a laptop that is a few hours. On a deployed demo it is however long since
 * the last release, and the drift is not cosmetic: a lesson seeded as "today"
 * silently becomes yesterday's, drops out of every "today" query, and the
 * dashboard it was there to populate quietly empties out. That is a worse bug
 * than it looks, because nothing errors — the demo just gets thinner.
 *
 * So two things happen on read. The always-live lesson is nudged back into its
 * own join window, and if the calendar day has turned over the whole dataset is
 * rebuilt. Losing a demo visitor's edits at midnight is the right trade against
 * a demo that decays.
 */
export function refreshDemoClock(): void {
  const now = new Date();
  const today = calendarDay(now);

  if (demoState.seededOn !== today) {
    /* Midday rather than midnight, so a whole-day difference is never turned
       into an off-by-one by a daylight-saving shift on the boundary. */
    const seeded = new Date(`${demoState.seededOn}T12:00:00Z`);

    if (Number.isNaN(seeded.getTime())) {
      /* No usable anchor — a state pinned to globalThis by a build that
         predates this field. There is no way to know how far it has drifted,
         so it is adopted as today's rather than guessed at. The dates stay
         where they are until the process restarts, which is the honest
         outcome and not a crash. */
      demoState.seededOn = today;
    } else {
      const days = calendarDayDelta(now, seeded);
      if (days !== 0) shiftDemoDates(demoState, days);
      demoState.seededOn = today;
    }
  }

  for (const id of LIVE_LESSON_IDS) {
    const lesson = demoState.lessons.find((l) => l.id === id);
    // Left alone once it has been cancelled or written up: at that point the
    // demo has moved on and pulling it back to "now" would undo the change.
    if (lesson && lesson.status === "scheduled") lesson.scheduledAt = anchorLive();
  }
}

/** The calendar day in the portal's zone, which is the one the dataset was
 *  built against — the machine's own day can be a different date. Zero-padded,
 *  so the value round-trips back through `new Date()` when the shift is
 *  worked out. */
function calendarDay(date: Date): string {
  const { year, month, day } = zonedParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Move every date in the demo forward by whole days.
 *
 * Rebuilding the dataset from scratch would be the obvious fix, but the demo
 * is not one list — the notes, homework, transcripts and notifications are all
 * pinned to lesson times, and re-deriving that web is a large change for a
 * demo-only problem. Shifting instead keeps the whole arc internally
 * consistent by construction: every timestamp moves by the same amount, so
 * "the lesson before last" stays the lesson before last.
 *
 * A blanket walk is safe here precisely because this is invented data. There
 * is no timestamp in it that means anything absolute — every one of them was
 * written as "n days from when this was seeded", so every one of them should
 * move.
 */
function shiftDemoDates(node: unknown, days: number): void {
  if (Array.isArray(node)) {
    for (const item of node) shiftDemoDates(item, days);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      if (ISO_TIMESTAMP.test(value)) {
        record[key] = new Date(new Date(value).getTime() + days * 86_400_000).toISOString();
      }
    } else {
      shiftDemoDates(value, days);
    }
  }
}

export function resetDemoState(): void {
  Object.assign(demoState, seed());
}

export function demoId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
