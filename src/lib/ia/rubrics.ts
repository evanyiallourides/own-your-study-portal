/* ==========================================================================
   IB internal assessment — the marking models
   --------------------------------------------------------------------------
   What each subject is marked out of, and which model applies to which
   examination session. Deliberately free of `server-only`: the checkout page,
   the upload form and the tests all need to know what a Biology IA is marked
   out of, and none of them should have to reach a model to find out.

   Two things live here and nothing else does:

     1. The STRUCTURE of each model — criterion ids, maxima, the total. These
        are published facts, taken from the official subject briefs, and they
        are safe to state.

     2. The ROUTING from an examination session to a model. Which is the part
        that is actually easy to get wrong, and the reason this is not a
        constant: the Maths analysis course changes in 2029, and a report
        uploaded in 2027 for a 2029 sitting must not be marked against the
        rubric its file happens to arrive under.

   What does NOT live here is the achievement descriptors — the sentences that
   decide whether a piece of work is a 4 or a 5. Those are IB's, they are not
   public, and we have not got them. `packs.ts` is where an operator installs
   them, and until one is installed this whole subsystem gives feedback and
   withholds marks. That is not a limitation to be worked around later; it is
   the behaviour.
   ========================================================================== */

export const IA_SUBJECTS = ["biology", "chemistry", "maths_aa"] as const;
export type IaSubject = (typeof IA_SUBJECTS)[number];

export const IA_LEVELS = ["SL", "HL"] as const;
export type IaLevel = (typeof IA_LEVELS)[number];

/** How finished the thing being marked is. It changes what an absence means. */
export const DRAFT_STAGES = ["partial_draft", "complete_draft", "final"] as const;
export type DraftStage = (typeof DRAFT_STAGES)[number];

export const SUBJECT_LABEL: Record<IaSubject, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  maths_aa: "Mathematics: Analysis and Approaches",
};

/** What the task is called in each subject. Students use these words. */
export const TASK_LABEL: Record<IaSubject, string> = {
  biology: "scientific investigation",
  chemistry: "scientific investigation",
  maths_aa: "mathematical exploration",
};

export interface Criterion {
  id: string;
  /** IB's own letter, where the subject uses one. Sciences dropped them. */
  letter: string | null;
  name: string;
  max: number;
  /**
   * A short orientation, NOT a descriptor.
   *
   * Every one of these is a paraphrase of what the criterion is about, written
   * to help a student find the right part of their report. None of them is
   * sufficient to award a mark, and the prompt says so in as many words —
   * because the predictable failure here is a model treating a one-line gloss
   * as if it were the band it is standing in for.
   */
  orientation: string;
  /** True where SL and HL are marked against different descriptors. */
  levelSpecific?: boolean;
}

export interface RubricModel {
  id: string;
  subject: IaSubject;
  /** Shown to students and stored on the submission. */
  name: string;
  criteria: readonly Criterion[];
  maxTotal: number;
  /** Words. Null where the subject publishes no limit we have confirmed. */
  wordLimit: number | null;
  /** Percentage of the final subject grade, at both levels. */
  weighting: number;
  /** Whether this model can be marked at all, and why not when it cannot. */
  markable: { ok: true } | { ok: false; reason: string };
}

/* --------------------------------------------------------------------------
   The sciences
   --------------------------------------------------------------------------
   Biology and Chemistry are marked identically — same four criteria, same six
   marks each, same twenty-four — and the same rubric applies at SL and at HL.

   That last point is stated loudly because both packs list it as a release
   check: "switching only SL to HL does not change the rubric or add a
   sophistication penalty". A model that has read a lot of the internet
   believes HL work should be held to a higher standard. For this task, it
   should not.
   -------------------------------------------------------------------------- */

const SCIENCE_CRITERIA: readonly Criterion[] = [
  {
    id: "research_design",
    letter: null,
    name: "Research design",
    max: 6,
    orientation:
      "The research question and its context, and whether the method described is justified and could actually be repeated by someone else.",
  },
  {
    id: "data_analysis",
    letter: null,
    name: "Data analysis",
    max: 6,
    orientation:
      "Whether the data are recorded, processed and presented clearly and correctly, and whether uncertainty has been considered.",
  },
  {
    id: "conclusion",
    letter: null,
    name: "Conclusion",
    max: 6,
    orientation:
      "Whether the answer given is supported by the results, and interpreted against the relevant scientific context.",
  },
  {
    id: "evaluation",
    letter: null,
    name: "Evaluation",
    max: 6,
    orientation:
      "Whether the limitations named are specific to this investigation, weighed for relative impact, and answered by improvements that follow from them.",
  },
] as const;

/* --------------------------------------------------------------------------
   Mathematics: Analysis and Approaches
   --------------------------------------------------------------------------
   Five criteria, twenty marks, and one genuine complication: criterion E is
   the only place in any of the three subjects where SL and HL are marked
   against different descriptors. The pack is explicit that they must be loaded
   separately, so `levelSpecific` is carried on the criterion and the pack
   loader refuses a pack that does not supply both.
   -------------------------------------------------------------------------- */

const MATHS_AA_CRITERIA: readonly Criterion[] = [
  {
    id: "presentation",
    letter: "A",
    name: "Presentation",
    max: 4,
    orientation:
      "Whether the exploration is organised and coherent — whether a reader can follow it from aim to conclusion without reconstructing it.",
  },
  {
    id: "mathematical_communication",
    letter: "B",
    name: "Mathematical communication",
    max: 4,
    orientation:
      "Whether the mathematics itself is expressed properly: notation, symbols defined, terminology, and consistent use of them.",
  },
  {
    id: "personal_engagement",
    letter: "C",
    name: "Personal engagement",
    max: 3,
    orientation:
      "Where the student makes substantive mathematical decisions of their own, rather than where they write in the first person.",
  },
  {
    id: "reflection",
    letter: "D",
    name: "Reflection",
    max: 3,
    orientation:
      "Where the exploration examines what a result means, or changes direction because of something it found.",
  },
  {
    id: "use_of_mathematics",
    letter: "E",
    name: "Use of mathematics",
    max: 6,
    orientation:
      "Whether the mathematics is relevant, correct, and understood — as distinct from whether a calculator returned the right answer.",
    levelSpecific: true,
  },
] as const;

/* --------------------------------------------------------------------------
   The models themselves
   -------------------------------------------------------------------------- */

export const RUBRICS: Readonly<Record<string, RubricModel>> = {
  biology_fa2025: {
    id: "biology_fa2025",
    subject: "biology",
    name: "Biology scientific investigation (first assessment 2025)",
    criteria: SCIENCE_CRITERIA,
    maxTotal: 24,
    wordLimit: 3000,
    weighting: 20,
    markable: { ok: true },
  },
  chemistry_fa2025: {
    id: "chemistry_fa2025",
    subject: "chemistry",
    name: "Chemistry scientific investigation (first assessment 2025)",
    criteria: SCIENCE_CRITERIA,
    maxTotal: 24,
    wordLimit: 3000,
    weighting: 20,
    markable: { ok: true },
  },
  maths_aa_fa2021: {
    id: "maths_aa_fa2021",
    subject: "maths_aa",
    name: "Maths AA exploration (first assessment 2021)",
    criteria: MATHS_AA_CRITERIA,
    maxTotal: 20,
    // The AA pack does not confirm one, and the science limit must not be
    // borrowed across: "do not transplant Chemistry's report limit ... into
    // Maths AA". A word count we have not verified is not a word count.
    wordLimit: null,
    weighting: 20,
    markable: { ok: true },
  },

  /* The 2029 course. Four new criteria, common to SL and HL, confirmed by the
     official subject brief — which verifies the STRUCTURE and not the
     descriptors. So it exists here, it is routed to correctly, and it refuses
     to be marked. A blocked model that is named is far better than silently
     marking a 2029 exploration against the 2021 rubric, which is what an
     absent entry would do. */
  maths_aa_fa2029: {
    id: "maths_aa_fa2029",
    subject: "maths_aa",
    name: "Maths AA exploration (first assessment 2029)",
    criteria: [
      {
        id: "problem_specification",
        letter: "A",
        name: "Problem specification",
        max: 4,
        orientation: "Structure confirmed by the official subject brief; descriptors not held.",
      },
      {
        id: "abstraction",
        letter: "B",
        name: "Abstraction",
        max: 6,
        orientation: "Structure confirmed by the official subject brief; descriptors not held.",
      },
      {
        id: "computation",
        letter: "C",
        name: "Computation",
        max: 4,
        orientation: "Structure confirmed by the official subject brief; descriptors not held.",
      },
      {
        id: "interpretation",
        letter: "D",
        name: "Interpretation",
        max: 6,
        orientation: "Structure confirmed by the official subject brief; descriptors not held.",
      },
    ],
    maxTotal: 20,
    wordLimit: null,
    weighting: 20,
    markable: {
      ok: false,
      reason:
        "The Mathematics: Analysis and Approaches course changes for first assessment in 2029. " +
        "Its four criteria are confirmed, but the achievement descriptors are a separate " +
        "assessment pack we do not hold — so an exploration for a 2029 or later session cannot " +
        "be marked here yet, and must not be marked against the current five-criterion rubric.",
    },
  },
} as const;

/**
 * The models an operator can install descriptors for.
 *
 * Lives here rather than beside the database code that reads them, because the
 * admin form needs it and that form is a client component — importing it from
 * `pack-store.ts` pulled the service-role Supabase client into a browser
 * bundle, which the build refuses and rightly so.
 *
 * `maths_aa_fa2029` is deliberately absent: its descriptors are not ours to
 * hold yet, and offering a slot to install them into would suggest otherwise.
 */
export const INSTALLABLE_RUBRICS = [
  "biology_fa2025",
  "chemistry_fa2025",
  "maths_aa_fa2021",
] as const;

export function rubricById(id: string | null | undefined): RubricModel | null {
  if (!id) return null;
  return RUBRICS[id] ?? null;
}

export function criterionIn(rubric: RubricModel, id: string): Criterion | null {
  return rubric.criteria.find((c) => c.id === id) ?? null;
}

/* --------------------------------------------------------------------------
   Sessions
   --------------------------------------------------------------------------
   An IB examination session is a month and a year — "May 2026". Both halves
   matter: the year routes to a course model, and the month is what a student
   will recognise on their own timetable.
   -------------------------------------------------------------------------- */

export const SESSION_MONTHS = ["May", "November"] as const;
export type SessionMonth = (typeof SESSION_MONTHS)[number];

export interface Session {
  month: SessionMonth;
  year: number;
}

/** The earliest and latest sessions worth offering in a form. */
const SESSION_FLOOR = 2024;
const SESSION_CEILING = 2032;

export function parseSession(value: string | null | undefined): Session | null {
  if (!value) return null;
  const match = /^(May|November)\s+(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const year = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isInteger(year) || year < SESSION_FLOOR || year > SESSION_CEILING) return null;
  return { month: match[1] as SessionMonth, year };
}

export function formatSession(session: Session): string {
  return `${session.month} ${session.year}`;
}

/** Every session the upload form offers, nearest first. */
export function selectableSessions(today = new Date()): Session[] {
  const from = today.getUTCFullYear();
  const out: Session[] = [];
  for (let year = from; year <= Math.min(SESSION_CEILING, from + 3); year += 1) {
    for (const month of SESSION_MONTHS) {
      // A session that has already been sat is not one you upload a draft for.
      const sat = new Date(Date.UTC(year, month === "May" ? 5 : 11, 1));
      if (sat < today) continue;
      out.push({ month, year });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
   Routing
   --------------------------------------------------------------------------
   The one rule worth stating in prose, because all three packs state it and it
   is the mistake they are most worried about:

       Do not select a rubric from the date an IA was uploaded.

   A student uploads in October 2027 for a May 2029 sitting. The file is
   current; the course it is being marked against is not the one running the
   day it arrived. Everything below keys off the session the student names, and
   nothing keys off `now`.
   -------------------------------------------------------------------------- */

export interface Routing {
  rubric: RubricModel;
  /** Set when the session falls outside anything we can mark. */
  blocked: string | null;
}

export function routeToRubric(subject: IaSubject, session: Session): Routing {
  if (subject === "maths_aa") {
    /* The current courses end with the November 2028 assessment; teaching of
       the revised course starts 2027, first assessment 2029. The boundary is
       therefore the session year, not the teaching year. */
    const rubric =
      session.year >= 2029 ? RUBRICS.maths_aa_fa2029! : RUBRICS.maths_aa_fa2021!;
    return {
      rubric,
      blocked: rubric.markable.ok ? null : rubric.markable.reason,
    };
  }

  const rubric = subject === "biology" ? RUBRICS.biology_fa2025! : RUBRICS.chemistry_fa2025!;

  /* The sciences changed for first assessment in 2025, and the previous model
     had five criteria including Personal engagement. A pre-2025 session is a
     different rubric we do not hold — and importing an old exemplar's score
     into the new one is called out in both science packs as a thing not to do. */
  if (session.year < 2025) {
    return {
      rubric,
      blocked:
        `${SUBJECT_LABEL[subject]} was assessed against a different, five-criterion model before ` +
        `first assessment in 2025. A ${formatSession(session)} report cannot be marked against ` +
        `the current four-criterion rubric, and we do not hold the previous one.`,
    };
  }

  return { rubric, blocked: null };
}

/** Criteria whose descriptors differ between SL and HL, for the given model. */
export function levelSpecificCriteria(rubric: RubricModel): Criterion[] {
  return rubric.criteria.filter((c) => c.levelSpecific === true);
}

/** Sanity: the stated total is the sum of the parts. Asserted in the tests. */
export function criteriaSum(rubric: RubricModel): number {
  return rubric.criteria.reduce((total, c) => total + c.max, 0);
}
