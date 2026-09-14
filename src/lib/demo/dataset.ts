/* ==========================================================================
   Demo dataset
   --------------------------------------------------------------------------
   The portal runs against this when no Supabase project is configured, so the
   whole product can be walked through — every role, every lesson state — with
   nothing installed. It is fiction: the names are invented, the transcript is
   written, and the UI says so on every page.

   Dates are relative to the moment the server starts, so "next Thursday" is
   always genuinely next Thursday and the dashboards never look stale.
   ========================================================================== */

import { instantFromZonedTime, zonedParts } from "@/lib/timezone";
import type {
  Order,
  Lesson,
  MeetingPlatform,
  Parent,
  Profile,
  Student,
  Subject,
  Tutor,
  UserRole,
} from "@/lib/types";

/* -- date helpers ---------------------------------------------------------
   Times are built in the portal's display zone, not the machine's. Generating
   "18:00" in whatever zone the server happens to run in and then rendering it
   in London gives a demo whose lessons drift by the offset — which is exactly
   the class of bug this module would otherwise be hiding.
   ------------------------------------------------------------------------ */

const REFERENCE = new Date();

function at(daysFromNow: number, hour: number, minute = 0): string {
  const today = zonedParts(REFERENCE);
  const shifted = zonedParts(
    new Date(Date.UTC(today.year, today.month - 1, today.day) + daysFromNow * 86_400_000),
  );
  return instantFromZonedTime(shifted.year, shifted.month, shifted.day, hour, minute).toISOString();
}

/* Twenty minutes in, so the lesson is comfortably inside its own join window
   rather than balanced on the edge of it. Exported because the demo store
   re-anchors these on each request: the state is parked on globalThis to
   survive hot reloads, so a lesson frozen at start-up would quietly stop being
   live once the server had been running for an hour. */
export function anchorLive(now: Date = new Date()): string {
  return new Date(now.getTime() - 20 * 60_000).toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/* -- people --------------------------------------------------------------- */

function profile(
  id: string,
  firstName: string,
  lastName: string,
  role: UserRole,
  email: string,
): Profile {
  return {
    id,
    email,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    role,
    avatarUrl: null,
    active: true,
  };
}

export const DEMO_PROFILES: Profile[] = [
  profile("p-sophia", "Sophia", "Thompson", "student", "sophia@demo.ownyourstudy.com"),
  profile("p-marcus", "Marcus", "Adeyemi", "student", "marcus@demo.ownyourstudy.com"),
  profile("p-imogen", "Imogen", "Kirby", "tutor", "imogen@demo.ownyourstudy.com"),
  profile("p-daniel", "Daniel", "Ferreira", "tutor", "daniel@demo.ownyourstudy.com"),
  profile("p-admin", "Rowan", "Hale", "admin", "admin@demo.ownyourstudy.com"),
  profile("p-helen", "Helen", "Thompson", "parent", "helen@demo.ownyourstudy.com"),
];

const byProfile = (id: string): Profile => {
  const found = DEMO_PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`Demo profile ${id} is missing`);
  return found;
};

export const DEMO_STUDENTS: Student[] = [
  {
    id: "s-sophia",
    profileId: "p-sophia",
    profile: byProfile("p-sophia"),
    programme: "IB Diploma Programme",
    yearLevel: "DP2",
    school: "Highgate International School",
    timezone: "Europe/London",
    transcriptAccessEnabled: true,
    consent: {
      aiNotetakerConsent: true,
      transcriptionConsent: true,
      guardianConsentRequired: true,
      guardianConsentReceived: true,
      consentTimestamp: at(-96, 9, 12),
    },
  },
  {
    id: "s-marcus",
    profileId: "p-marcus",
    profile: byProfile("p-marcus"),
    programme: "A Level",
    yearLevel: "Year 13",
    school: "Wheatfield Sixth Form",
    timezone: "Europe/London",
    transcriptAccessEnabled: true,
    consent: {
      aiNotetakerConsent: true,
      transcriptionConsent: true,
      guardianConsentRequired: false,
      guardianConsentReceived: false,
      consentTimestamp: at(-51, 18, 40),
    },
  },
];

export const DEMO_TUTORS: Tutor[] = [
  {
    id: "t-imogen",
    profileId: "p-imogen",
    profile: byProfile("p-imogen"),
    headline: "Chemistry — IB HL and A Level",
    bio: "Oxford MChem. Ten years teaching IB Chemistry HL, with a particular interest in getting mechanisms to click before exam technique is layered on top.",
    active: true,
  },
  {
    id: "t-daniel",
    profileId: "p-daniel",
    profile: byProfile("p-daniel"),
    headline: "Mathematics — IB AA HL and Further Maths",
    bio: "Imperial MSci. Teaches Analysis and Approaches HL with a focus on proof fluency and calculus foundations.",
    active: true,
  },
  /* The administrator also teaches. In a practice this size the person who
     runs it takes lessons too, so they hold the admin role and a tutor record
     on top of it — one account, both jobs. Present in the demo because an
     access path nobody can see is an access path nobody tests. */
  {
    id: "t-rowan",
    profileId: "p-admin",
    profile: byProfile("p-admin"),
    headline: "Physics — IB HL, and running the practice",
    bio: "Coordinates the network and still teaches a small number of students each term.",
    active: true,
  },
];

export const DEMO_PARENTS: Parent[] = [
  { id: "pa-helen", profileId: "p-helen", profile: byProfile("p-helen") },
];

export const DEMO_PARENT_STUDENTS: { parentId: string; studentId: string }[] = [
  { parentId: "pa-helen", studentId: "s-sophia" },
];

/* -- catalogue ------------------------------------------------------------ */

function subject(
  id: string,
  name: string,
  curriculum: string,
  level: string | null,
  division: string | null,
): Subject {
  return {
    id,
    name,
    curriculum,
    level,
    division,
    archived: false,
    displayName: [curriculum, name, level].filter(Boolean).join(" "),
  };
}

export const DEMO_SUBJECTS: Subject[] = [
  subject("sub-chem-hl", "Chemistry", "IB", "HL", "ib"),
  subject("sub-maths-aa-hl", "Mathematics AA", "IB", "HL", "ib"),
  subject("sub-biology-gcse", "Biology", "GCSE", null, "alevel"),
  subject("sub-chem-alevel", "Chemistry", "A Level", null, "alevel"),
  subject("sub-bio-ap", "Biology", "AP", null, "ap"),
  subject("sub-medicine", "Medicine", "University", "Year 1", "uni-studies"),
];

export const DEMO_STUDENT_SUBJECTS = [
  { id: "ss-1", studentId: "s-sophia", subjectId: "sub-chem-hl", active: true },
  { id: "ss-2", studentId: "s-sophia", subjectId: "sub-maths-aa-hl", active: true },
  { id: "ss-3", studentId: "s-marcus", subjectId: "sub-chem-alevel", active: true },
];

export const DEMO_ASSIGNMENTS = [
  {
    id: "a-1",
    tutorId: "t-imogen",
    studentId: "s-sophia",
    subjectId: "sub-chem-hl",
    active: true,
    createdAt: at(-120, 10),
  },
  {
    id: "a-2",
    tutorId: "t-daniel",
    studentId: "s-sophia",
    subjectId: "sub-maths-aa-hl",
    active: true,
    createdAt: at(-96, 10),
  },
  {
    id: "a-3",
    tutorId: "t-imogen",
    studentId: "s-marcus",
    subjectId: "sub-chem-alevel",
    active: true,
    createdAt: at(-60, 10),
  },
];

/* -- lessons --------------------------------------------------------------
   Enough of them, in enough states, that every branch of the UI has something
   real to render: published history, one draft waiting on the tutor, one still
   being processed, one scheduled, one cancelled, one failed.
   ------------------------------------------------------------------------ */

interface DemoLessonSeed {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string;
  title: string | null;
  daysFromNow: number;
  hour: number;
  minute?: number;
  duration?: number;
  status: Lesson["status"];
  published: boolean;
  platform?: Lesson["meetingPlatform"];
  notetaker?: boolean;
  error?: string | null;
  /** Booked without a meeting link, so the "no link yet" state and the button
   *  that fixes it are both visible in demo rather than only in production. */
  noLink?: boolean;
  /** Place this lesson so it is in progress right now, whenever "now" is.
   *  Without one of these the join window is never open in demo mode and the
   *  most important state the join control has is the one you cannot see. */
  liveNow?: boolean;
}

const LESSON_SEEDS: DemoLessonSeed[] = [
  // Sophia · Chemistry HL — the spine of the demo
  { id: "l-chem-1", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Atomic structure and periodicity", daysFromNow: -63, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-2", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Bonding and intermolecular forces", daysFromNow: -56, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-3", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Energetics: Hess's law and bond enthalpies", daysFromNow: -49, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-4", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Equilibrium and Le Chatelier's principle", daysFromNow: -42, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-5", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Acids and bases: pH, Ka and buffers", daysFromNow: -35, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-6", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Redox and electrochemical cells", daysFromNow: -28, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-7", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Organic chemistry: functional groups and nomenclature", daysFromNow: -21, hour: 18, status: "published", published: true, notetaker: true },
  { id: "l-chem-8", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Organic chemistry: SN1 and SN2 mechanisms", daysFromNow: -14, hour: 18, status: "published", published: true, notetaker: true },
  // The one waiting on Imogen. This is what the review workflow opens on.
  { id: "l-chem-9", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Elimination reactions: E1 and E2", daysFromNow: -2, hour: 18, status: "review_required", published: false, notetaker: true },
  // Still being worked on by the pipeline.
  { id: "l-chem-10", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: null, daysFromNow: -1, hour: 17, status: "processing_transcript", published: false, notetaker: true },
  // Happening right now, so the live join state is always visible in demo.
  { id: "l-chem-live", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Kinetics: rate laws and the Arrhenius equation", daysFromNow: 0, hour: 0, liveNow: true, status: "scheduled", published: false, notetaker: true },
  // Upcoming.
  { id: "l-chem-11", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Reaction pathways and synthesis routes", daysFromNow: 2, hour: 18, status: "scheduled", published: false, notetaker: true },
  { id: "l-chem-12", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Spectroscopy: IR, MS and NMR", daysFromNow: 9, hour: 18, status: "scheduled", published: false, notetaker: true },
  // Booked, but nobody has sorted the link out yet — the usual state of a
  // lesson a few days after it was put in the diary.
  { id: "l-chem-13", studentId: "s-sophia", tutorId: "t-imogen", subjectId: "sub-chem-hl", title: "Periodicity: trends across the third period", daysFromNow: 5, hour: 18, status: "scheduled", published: false, notetaker: true, noLink: true },

  // Sophia · Maths AA HL
  { id: "l-math-1", studentId: "s-sophia", tutorId: "t-daniel", subjectId: "sub-maths-aa-hl", title: "Differentiation: chain, product and quotient rules", daysFromNow: -30, hour: 17, status: "published", published: true, platform: "zoom", notetaker: true },
  { id: "l-math-2", studentId: "s-sophia", tutorId: "t-daniel", subjectId: "sub-maths-aa-hl", title: "Integration by substitution", daysFromNow: -16, hour: 17, status: "published", published: true, platform: "zoom", notetaker: true },
  { id: "l-math-3", studentId: "s-sophia", tutorId: "t-daniel", subjectId: "sub-maths-aa-hl", title: "Proof by induction", daysFromNow: -9, hour: 17, status: "published", published: true, platform: "zoom", notetaker: true },
  { id: "l-math-4", studentId: "s-sophia", tutorId: "t-daniel", subjectId: "sub-maths-aa-hl", title: "Complex numbers and De Moivre's theorem", daysFromNow: -3, hour: 17, status: "failed", published: false, platform: "zoom", notetaker: true, error: "The notetaker was removed from the call before a transcript was produced." },
  { id: "l-math-5", studentId: "s-sophia", tutorId: "t-daniel", subjectId: "sub-maths-aa-hl", title: "Vectors: lines and planes", daysFromNow: 4, hour: 17, status: "scheduled", published: false, platform: "zoom", notetaker: true },

  // Marcus · A Level Chemistry — exists so cross-student access can be tested.
  { id: "l-alevel-1", studentId: "s-marcus", tutorId: "t-imogen", subjectId: "sub-chem-alevel", title: "Rate equations and orders of reaction", daysFromNow: -10, hour: 16, status: "published", published: true, platform: "teams", notetaker: true },
  { id: "l-alevel-2", studentId: "s-marcus", tutorId: "t-imogen", subjectId: "sub-chem-alevel", title: "Transition metals and complex ions", daysFromNow: -4, hour: 16, status: "review_required", published: false, platform: "teams", notetaker: true },
  { id: "l-alevel-3", studentId: "s-marcus", tutorId: "t-imogen", subjectId: "sub-chem-alevel", title: "Buffers and titration curves", daysFromNow: 0, hour: 16, status: "scheduled", published: false, platform: "teams", notetaker: true },
  { id: "l-alevel-4", studentId: "s-marcus", tutorId: "t-imogen", subjectId: "sub-chem-alevel", title: "Organic synthesis routes", daysFromNow: -23, hour: 16, status: "cancelled", published: false, platform: "teams" },
];

export const DEMO_LESSONS: Lesson[] = LESSON_SEEDS.map((seed) => {
  const duration = seed.duration ?? 60;
  const scheduledAt = seed.liveNow
    ? anchorLive(REFERENCE)
    : at(seed.daysFromNow, seed.hour, seed.minute ?? 0);
  const isPast = new Date(scheduledAt).getTime() < REFERENCE.getTime();
  const ran = isPast && seed.status !== "cancelled";
  const platform = seed.platform ?? "google_meet";
  return {
    id: seed.id,
    studentId: seed.studentId,
    tutorId: seed.tutorId,
    subjectId: seed.subjectId,
    title: seed.title,
    scheduledAt,
    durationMinutes: duration,
    startedAt: ran ? scheduledAt : null,
    endedAt: ran ? plusMinutes(scheduledAt, duration) : null,
    meetingUrl:
      seed.noLink || seed.status === "cancelled" ? null : demoMeetingUrl(platform, seed.id),
    meetingPlatform: platform,
    status: seed.status,
    published: seed.published,
    publishedAt: seed.published ? plusMinutes(scheduledAt, duration + 90) : null,
    notetakerEnabled: seed.notetaker ?? false,
    recallBotId: seed.notetaker ? `demo-bot-${seed.id}` : null,
    processingError: seed.error ?? null,
    /* Demo links are pasted-in links, not ones the portal created — there is
       no Google account behind demo mode and the interface should not claim
       it can move or revoke them. */
    googleEventId: null,
    googleCalendarId: null,
    meetLinkManaged: false,
  };
});

/** Which demo lessons are meant to be in progress whenever anyone looks. */
export const LIVE_LESSON_IDS: readonly string[] = LESSON_SEEDS.filter((s) => s.liveNow).map(
  (s) => s.id,
);

/* Shaped like the real thing — a Meet code really is three letters, four,
   three — so the link parser has something authentic to read and the demo
   shows the same meeting code a live lesson would. Derived from the lesson id
   so it is stable across restarts. */
function demoMeetingUrl(platform: MeetingPlatform, lessonId: string): string {
  const letters = "abcdefghijkmnopqrstuvwxyz";
  let hash = 0;
  for (const character of lessonId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

  const pick = (count: number) => {
    let out = "";
    for (let i = 0; i < count; i += 1) {
      hash = (hash * 1103515245 + 12345) >>> 0;
      out += letters[hash % letters.length];
    }
    return out;
  };

  if (platform === "zoom") {
    const digits = String(81000000000 + (hash % 999999999));
    return `https://us02web.zoom.us/j/${digits}`;
  }
  if (platform === "teams") {
    return `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${lessonId}%40thread.v2/0?context=%7b%7d`;
  }
  return `https://meet.google.com/${pick(3)}-${pick(4)}-${pick(3)}`;
}

/* ==========================================================================
   Orders
   --------------------------------------------------------------------------
   One of every state the admin screen has a branch for, so the whole thing can
   be walked through without a database — including the two that ask for a
   human: a payment nobody is attached to, and a plan that has stopped
   collecting.
   ========================================================================== */

export const DEMO_ORDERS: Order[] = [
  {
    id: "o-committed-sophia",
    provider: "stripe",
    skuSlug: "committed-20hr",
    skuName: "Committed Pack",
    plan: "full",
    quantity: 1,
    instalmentMonths: null,
    instalmentsPaid: 0,
    currency: "eur",
    amountTotalMinor: 114_000,
    amountPaidMinor: 114_000,
    taxAmountMinor: 0,
    status: "paid",
    buyerEmail: "helen@demo.ownyourstudy.com",
    buyerName: "Helen Thompson",
    buyerCountry: "IE",
    sourceSite: "own-your-ib",
    studentId: "s-sophia",
    studentName: "Sophia Thompson",
    claimedAt: at(-9, 10),
    note: null,
    createdAt: at(-9, 10),
    grantsQuestionBankDays: null,
  },
  {
    /* Money taken, nobody attached. The queue this screen exists for: bought
       from the marketing site by someone with no portal account yet. */
    id: "o-qbank-unmatched",
    provider: "stripe",
    skuSlug: "question-bank",
    skuName: "Question Bank Access",
    plan: "full",
    quantity: 1,
    instalmentMonths: null,
    instalmentsPaid: 0,
    currency: "gbp",
    amountTotalMinor: 8_900,
    amountPaidMinor: 8_900,
    taxAmountMinor: 0,
    status: "paid",
    buyerEmail: "jo.mensah@example.com",
    buyerName: "Jo Mensah",
    buyerCountry: "GB",
    sourceSite: "own-your-ib",
    studentId: null,
    studentName: null,
    claimedAt: null,
    note: null,
    createdAt: at(-2, 14),
    grantsQuestionBankDays: 365,
  },
  {
    id: "o-elite-marcus",
    provider: "stripe",
    skuSlug: "elite-60s",
    skuName: "Elite Program",
    plan: "instalments",
    quantity: 1,
    instalmentMonths: 6,
    instalmentsPaid: 2,
    currency: "usd",
    amountTotalMinor: 720_000,
    amountPaidMinor: 240_000,
    taxAmountMinor: 0,
    status: "instalments_active",
    buyerEmail: "marcus@demo.ownyourstudy.com",
    buyerName: "Marcus Adeyemi",
    buyerCountry: "US",
    sourceSite: "own-your-ap",
    studentId: "s-marcus",
    studentName: "Marcus Adeyemi",
    claimedAt: at(-62, 9),
    note: null,
    createdAt: at(-62, 9),
    grantsQuestionBankDays: null,
  },
  {
    /* An instalment that failed. Access is deliberately NOT revoked here —
       the provider retries for weeks. */
    id: "o-momentum-pastdue",
    provider: "stripe",
    skuSlug: "momentum-20s",
    skuName: "Momentum Program",
    plan: "instalments",
    quantity: 1,
    instalmentMonths: 4,
    instalmentsPaid: 2,
    currency: "aud",
    amountTotalMinor: 368_000,
    amountPaidMinor: 184_000,
    taxAmountMinor: 16_727,
    status: "past_due",
    buyerEmail: "helen@demo.ownyourstudy.com",
    buyerName: "Helen Thompson",
    buyerCountry: "AU",
    sourceSite: "own-your-ib",
    studentId: "s-sophia",
    studentName: "Sophia Thompson",
    claimedAt: at(-95, 11),
    note: null,
    createdAt: at(-95, 11),
    grantsQuestionBankDays: null,
  },
  {
    id: "o-starter-refunded",
    provider: "stripe",
    skuSlug: "starter-5hr",
    skuName: "Starter Pack",
    plan: "full",
    quantity: 1,
    instalmentMonths: null,
    instalmentsPaid: 0,
    currency: "eur",
    amountTotalMinor: 34_000,
    amountPaidMinor: 34_000,
    taxAmountMinor: 0,
    status: "refunded",
    buyerEmail: "claire.dubois@example.com",
    buyerName: "Claire Dubois",
    buyerCountry: "FR",
    sourceSite: "own-your-ib",
    studentId: null,
    studentName: null,
    claimedAt: null,
    note: "Changed their mind within fourteen days.",
    createdAt: at(-20, 16),
    grantsQuestionBankDays: null,
  },
];
