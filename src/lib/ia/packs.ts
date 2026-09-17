/* ==========================================================================
   Assessment packs — the descriptors, and who is allowed to supply them
   --------------------------------------------------------------------------
   `rubrics.ts` holds the structure of each model: four criteria, six marks
   each, twenty-four in total. Those are published facts from the subject
   briefs and it is safe to state them.

   This file is about the other half — the achievement descriptors, the
   sentences that decide whether a piece of work sits at 3 or at 4. We do not
   have them. They are IB's, they are not published, and all three source packs
   say the same thing about what to do in the meantime:

       "Until they are supplied, use qualitative feedback only."
       "If the full applicable descriptors ... are unresolved, provide
        qualitative feedback and set marks to null."

   So an assessment pack is a thing an operator INSTALLS, against a specific
   rubric model, from material they are licensed to hold. Until one is
   installed for the model a submission routes to, this subsystem gives
   feedback and withholds marks. Not as a degraded mode to be quietly improved
   later — as the correct answer to a question we cannot yet answer.

   Three properties make that hold up rather than being a comment:

     · a pack must cover EVERY criterion of its model, and both levels of any
       criterion whose descriptors differ by level, or it does not load at all.
       A pack missing criterion E would otherwise mark four fifths of a Maths
       exploration and invent the rest;

     · a pack carries a version and a checksum, both stored on every review it
       produced, so a mark can always be traced to the exact text that produced
       it — and so replacing a pack does not silently restate old reviews;

     · nothing here reads a pack out of the student's document. The report is
       evidence. Only material an operator deliberately designated is
       authority. That distinction is the whole of the prompt-injection
       defence, and it is enforced by where the bytes come from rather than by
       asking a model to be careful.
   ========================================================================== */

import {
  levelSpecificCriteria,
  rubricById,
  type IaLevel,
  type RubricModel,
} from "@/lib/ia/rubrics";

/** Descriptors for one criterion: the bands, lowest to highest. */
export interface CriterionDescriptors {
  criterionId: string;
  /**
   * One entry per achievement band, in ascending order. `marks` is the band's
   * range — IB bands are ranges, not single marks — and `text` is the
   * descriptor verbatim.
   */
  bands: { marks: string; text: string }[];
  /** Anything the guide adds beneath the table for this criterion. */
  clarifications?: string[];
}

export interface AssessmentPack {
  /** Which model in `rubrics.ts` these descriptors belong to. */
  rubricId: string;
  /**
   * The operator's own label for this edition — "Biology guide, first
   * assessment 2025, published Feb 2023". Stored on every review.
   */
  version: string;
  /** Where it came from, for the audit trail. Never shown to a student. */
  source: string;
  /**
   * Descriptors shared by both levels, keyed by criterion id.
   */
  shared: Record<string, CriterionDescriptors>;
  /**
   * Descriptors that differ by level, keyed level -> criterion id. Only needed
   * for criteria the model marks `levelSpecific` — Maths AA criterion E is the
   * only one across the three subjects.
   */
  byLevel?: Partial<Record<IaLevel, Record<string, CriterionDescriptors>>>;
  /** Guidance that applies to the whole task rather than one criterion. */
  generalGuidance?: string[];
  /**
   * Best-fit instructions. Every one of the three packs insists the mark comes
   * from the official best-fit wording rather than from counting ticks, so if
   * the operator has it, it travels with the descriptors.
   */
  bestFitGuidance?: string[];
  /** Set by `installPack`. A pack that has not been through it is not trusted. */
  checksum?: string;
  installedAt?: string;
}

/* --------------------------------------------------------------------------
   Validation
   --------------------------------------------------------------------------
   A pack either covers its model completely or does not load. There is no
   partial mode: the failure it prevents is a model marking the criteria it was
   given descriptors for and confabulating the rest, which looks exactly like a
   working system.
   -------------------------------------------------------------------------- */

export type PackProblem = { field: string; detail: string };

export interface PackValidation {
  ok: boolean;
  problems: PackProblem[];
  rubric: RubricModel | null;
}

export function validatePack(pack: AssessmentPack): PackValidation {
  const problems: PackProblem[] = [];
  const rubric = rubricById(pack.rubricId);

  if (!rubric) {
    return {
      ok: false,
      rubric: null,
      problems: [{ field: "rubricId", detail: `No marking model called "${pack.rubricId}".` }],
    };
  }

  if (!pack.version?.trim()) {
    problems.push({
      field: "version",
      detail: "A pack must name its edition, so a mark can be traced back to the text behind it.",
    });
  }

  if (!rubric.markable.ok) {
    problems.push({
      field: "rubricId",
      detail:
        `${rubric.name} is blocked from marking regardless of descriptors: ${rubric.markable.reason}`,
    });
  }

  const levelSpecific = new Set(levelSpecificCriteria(rubric).map((c) => c.id));

  for (const criterion of rubric.criteria) {
    if (levelSpecific.has(criterion.id)) {
      /* Both levels or neither. Half of criterion E is not criterion E, and
         the Maths pack lists "a 2029 session blocks the current model" and
         "report results separately for SL and HL, especially E" as separate
         release checks for exactly this reason. */
      for (const level of ["SL", "HL"] as const) {
        const entry = pack.byLevel?.[level]?.[criterion.id];
        if (!describesBands(entry)) {
          problems.push({
            field: `byLevel.${level}.${criterion.id}`,
            detail: `${criterion.name} is marked differently at ${level}; its ${level} descriptors are missing.`,
          });
        }
      }
      continue;
    }

    if (!describesBands(pack.shared[criterion.id])) {
      problems.push({
        field: `shared.${criterion.id}`,
        detail: `No descriptors for ${criterion.name} (${criterion.id}).`,
      });
    }
  }

  /* Descriptors for a criterion the model does not have mean the pack and the
     model disagree about what is being marked. Usually a pack built for the
     previous syllabus. */
  const known = new Set(rubric.criteria.map((c) => c.id));
  for (const id of Object.keys(pack.shared ?? {})) {
    if (!known.has(id)) {
      problems.push({
        field: `shared.${id}`,
        detail: `"${id}" is not a criterion of ${rubric.name}. Is this a pack for the previous syllabus?`,
      });
    }
  }

  return { ok: problems.length === 0, problems, rubric };
}

function describesBands(entry: CriterionDescriptors | undefined): boolean {
  if (!entry || !Array.isArray(entry.bands) || entry.bands.length === 0) return false;
  return entry.bands.every((b) => Boolean(b?.marks?.trim()) && Boolean(b?.text?.trim()));
}

/* --------------------------------------------------------------------------
   The descriptors that apply to one submission
   --------------------------------------------------------------------------
   Resolved per level, so a Maths HL exploration is given HL's criterion E and
   never SL's. The whole rubric goes into the assessment call: all three packs
   say not to rely on retrieval to happen to find every criterion, and a
   criterion that retrieval missed is one the model would score from memory.
   -------------------------------------------------------------------------- */

export function descriptorsFor(
  pack: AssessmentPack,
  rubric: RubricModel,
  level: IaLevel,
): CriterionDescriptors[] {
  return rubric.criteria.map((criterion) => {
    const levelled = pack.byLevel?.[level]?.[criterion.id];
    const entry = levelled ?? pack.shared[criterion.id];
    return entry ?? { criterionId: criterion.id, bands: [] };
  });
}

/* --------------------------------------------------------------------------
   Checksums
   --------------------------------------------------------------------------
   Content-addressed rather than trusting the version string. Two packs both
   labelled "2025 guide" with different text are two different packs, and a
   review produced under one must not be presented as though it were produced
   under the other.

   SHA-256 through WebCrypto, which exists in Node, in the browser and on
   Workers — this module is imported by the admin screen as well as the server.
   -------------------------------------------------------------------------- */

export async function checksumOf(pack: AssessmentPack): Promise<string> {
  const canonical = JSON.stringify({
    rubricId: pack.rubricId,
    shared: sortedKeys(pack.shared),
    byLevel: pack.byLevel
      ? { SL: sortedKeys(pack.byLevel.SL ?? {}), HL: sortedKeys(pack.byLevel.HL ?? {}) }
      : null,
    general: pack.generalGuidance ?? [],
    bestFit: pack.bestFitGuidance ?? [],
  });

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Stable key order, so an unchanged pack hashes the same twice. */
function sortedKeys<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

/* --------------------------------------------------------------------------
   Installed state
   --------------------------------------------------------------------------
   The loader is injected rather than imported. Packs live in the database in
   production — they are licensed text that must not be in the repository, and
   a Worker has no filesystem to read them from — but the marking service, the
   mode decision and every test can be handed a plain map instead.
   -------------------------------------------------------------------------- */

export interface PackLoader {
  /** The installed pack for a model, or null if none has been installed. */
  load(rubricId: string): Promise<AssessmentPack | null>;
}

/** A loader over packs already in memory. Used by the tests and by demo mode. */
export function staticLoader(packs: AssessmentPack[]): PackLoader {
  const byRubric = new Map(packs.map((p) => [p.rubricId, p]));
  return { load: async (rubricId) => byRubric.get(rubricId) ?? null };
}

/** The loader for a deployment with nothing installed. The honest default. */
export const EMPTY_LOADER: PackLoader = { load: async () => null };

export interface PackStatus {
  rubricId: string;
  rubricName: string;
  installed: boolean;
  version: string | null;
  checksum: string | null;
  installedAt: string | null;
  problems: PackProblem[];
}

/** What the admin screen shows: one row per model, marked or not marked. */
export async function packStatuses(
  loader: PackLoader,
  rubricIds: string[],
): Promise<PackStatus[]> {
  return Promise.all(
    rubricIds.map(async (rubricId) => {
      const rubric = rubricById(rubricId);
      const pack = await loader.load(rubricId);
      const validation = pack ? validatePack(pack) : null;
      return {
        rubricId,
        rubricName: rubric?.name ?? rubricId,
        installed: Boolean(pack && validation?.ok),
        version: pack?.version ?? null,
        checksum: pack?.checksum ?? null,
        installedAt: pack?.installedAt ?? null,
        problems: validation?.problems ?? [],
      };
    }),
  );
}
