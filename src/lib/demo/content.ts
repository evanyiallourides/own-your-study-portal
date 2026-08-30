/* ==========================================================================
   Demo content — notes, transcripts, files, homework, progress
   --------------------------------------------------------------------------
   Written rather than generated. The two organic chemistry lessons are done at
   full fidelity because they are what the transcript viewer and the review
   workflow open on; the rest carry enough substance to make the history and
   the progress screens honest.
   ========================================================================== */

import { DEMO_LESSONS } from "@/lib/demo/dataset";
import type {
  HomeworkItem,
  LessonFile,
  LessonNotesForTutor,
  Notification,
  TopicProgress,
  Transcript,
  TranscriptSegment,
} from "@/lib/types";

const lesson = (id: string) => {
  const found = DEMO_LESSONS.find((l) => l.id === id);
  if (!found) throw new Error(`Demo lesson ${id} is missing`);
  return found;
};

/* -- transcripts ---------------------------------------------------------- */

interface RawLine {
  speaker: "Imogen" | "Sophia" | "Daniel" | "Marcus";
  role: "tutor" | "student";
  at: number; // seconds from the start of the lesson
  text: string;
}

function toSegments(lines: RawLine[]): TranscriptSegment[] {
  return lines.map((line, index) => ({
    index,
    speaker: line.speaker,
    role: line.role,
    startSeconds: line.at,
    endSeconds: lines[index + 1]?.at ?? line.at + 12,
    text: line.text,
  }));
}

const SN_LINES: RawLine[] = [
  { speaker: "Imogen", role: "tutor", at: 12, text: "Right — last week we finished nomenclature and you were solid on it. Today is substitution. Before I draw anything, tell me what you already associate with SN1 and SN2." },
  { speaker: "Sophia", role: "student", at: 31, text: "SN2 is one step and SN1 is two steps. And SN1 has a carbocation in the middle." },
  { speaker: "Imogen", role: "tutor", at: 44, text: "Good. That is the mechanistic difference and you have it right. Now the harder question: given a substrate, how do you decide which one actually happens?" },
  { speaker: "Sophia", role: "student", at: 61, text: "You look at how substituted the carbon is. Primary goes SN2, tertiary goes SN1." },
  { speaker: "Imogen", role: "tutor", at: 74, text: "That is the first thing to look at, yes. Why does tertiary favour SN1 though — what is the actual reason?" },
  { speaker: "Sophia", role: "student", at: 88, text: "Because the carbocation is more stable when there are more alkyl groups around it." },
  { speaker: "Imogen", role: "tutor", at: 99, text: "Right, inductive donation and hyperconjugation stabilise it. There is a second reason as well, on the SN2 side. Think about the nucleophile's approach." },
  { speaker: "Sophia", role: "student", at: 118, text: "It comes in from the back... so if there are three methyl groups it can't really get to the carbon." },
  { speaker: "Imogen", role: "tutor", at: 131, text: "Exactly — steric hindrance to backside attack. So tertiary is doubly disfavoured for SN2 and favoured for SN1. Let's do a worked one. 2-bromo-2-methylpropane in aqueous ethanol." },
  { speaker: "Sophia", role: "student", at: 154, text: "That's tertiary, so SN1. The bromide leaves, you get the tertiary carbocation, then water attacks and you deprotonate to get the alcohol." },
  { speaker: "Imogen", role: "tutor", at: 176, text: "Perfect, including the deprotonation step, which people forget. What would the rate equation be?" },
  { speaker: "Sophia", role: "student", at: 189, text: "Rate equals k times the concentration of the halogenoalkane. First order — the nucleophile isn't in it." },
  { speaker: "Imogen", role: "tutor", at: 203, text: "Because the slow step does not involve it. Now the part that trips most people. Solvent. What does the solvent do to each mechanism?" },
  { speaker: "Sophia", role: "student", at: 221, text: "Polar solvents help SN1 because they stabilise the carbocation?" },
  { speaker: "Imogen", role: "tutor", at: 233, text: "Yes, and specifically polar protic — water, ethanol. They solvate both the cation and the leaving anion through hydrogen bonding. Now what about SN2?" },
  { speaker: "Sophia", role: "student", at: 251, text: "I think polar protic is bad for SN2? I'm not sure why." },
  { speaker: "Imogen", role: "tutor", at: 262, text: "Think about what the protic solvent does to the nucleophile itself, not to the substrate." },
  { speaker: "Sophia", role: "student", at: 274, text: "Oh — it hydrogen bonds to the nucleophile. So the nucleophile is surrounded and can't attack as easily." },
  { speaker: "Imogen", role: "tutor", at: 289, text: "That is it. It builds a solvent cage around the nucleophile and blunts it. Polar aprotic solvents — acetone, DMSO, DMF — dissolve the salt but cannot hydrogen bond to the anion, so the nucleophile stays naked and reactive." },
  { speaker: "Sophia", role: "student", at: 312, text: "So polar aprotic for SN2, polar protic for SN1." },
  { speaker: "Imogen", role: "tutor", at: 321, text: "Yes. Say that back to me in a fortnight and I will believe it has stuck. One more variable: the leaving group." },
  { speaker: "Sophia", role: "student", at: 335, text: "Iodide is the best leaving group and fluoride is the worst, because iodide is the most stable ion." },
  { speaker: "Imogen", role: "tutor", at: 349, text: "Right — weakest base, most stable once it leaves. Note that a better leaving group speeds up both mechanisms, so it does not help you choose between them." },
  { speaker: "Sophia", role: "student", at: 366, text: "That's the bit I got wrong on the last paper. I used the leaving group as the reason it was SN1." },
  { speaker: "Imogen", role: "tutor", at: 379, text: "Then that is worth writing down. Substrate first, then nucleophile strength, then solvent. Leaving group is a rate factor, not a selector. Try 1-bromobutane with sodium cyanide in DMSO." },
  { speaker: "Sophia", role: "student", at: 402, text: "Primary carbon, cyanide is a strong nucleophile, DMSO is polar aprotic — so SN2, and it goes with inversion." },
  { speaker: "Imogen", role: "tutor", at: 421, text: "All three reasons, and you remembered inversion of configuration. That is exactly the structure I want in the exam answer. Homework is questions four to twelve in the substitution set." },
  { speaker: "Sophia", role: "student", at: 439, text: "Four to twelve. Are twelve and thirteen the mechanism drawing ones?" },
  { speaker: "Imogen", role: "tutor", at: 449, text: "Twelve is. Do that one carefully with curly arrows — full marks there depend on the arrows starting from the right place. Thirteen is optional if you want more practice." },
];

const E12_LINES: RawLine[] = [
  { speaker: "Imogen", role: "tutor", at: 15, text: "Before elimination — solvents. Why do polar aprotic solvents favour SN2?" },
  { speaker: "Sophia", role: "student", at: 27, text: "Because they don't hydrogen bond to the nucleophile, so it stays reactive. Protic ones cage it." },
  { speaker: "Imogen", role: "tutor", at: 40, text: "That has stuck. Good. Elimination then. E1 and E2 are the competitors to SN1 and SN2, and the parallels are close." },
  { speaker: "Sophia", role: "student", at: 55, text: "So E1 has a carbocation too?" },
  { speaker: "Imogen", role: "tutor", at: 63, text: "It does — same first step as SN1. The difference is what happens next: instead of the nucleophile attacking the carbon, a base takes a proton from the adjacent carbon and the electrons form the double bond." },
  { speaker: "Sophia", role: "student", at: 84, text: "And E2 is one step like SN2." },
  { speaker: "Imogen", role: "tutor", at: 92, text: "Concerted, yes. Base removes the beta hydrogen while the leaving group departs. There is a geometric requirement though, and this is the part that is genuinely new. Anti-periplanar." },
  { speaker: "Sophia", role: "student", at: 112, text: "Meaning the hydrogen and the leaving group have to be opposite each other?" },
  { speaker: "Imogen", role: "tutor", at: 122, text: "At 180 degrees, in the same plane. Draw the Newman projection and it becomes obvious — the orbitals have to align to make the pi bond." },
  { speaker: "Sophia", role: "student", at: 138, text: "I find Newman projections hard to draw from a skeletal structure." },
  { speaker: "Imogen", role: "tutor", at: 148, text: "Worth practising deliberately, because in ring systems it decides the product entirely. Let's do the substitution-versus-elimination decision instead. What pushes toward elimination?" },
  { speaker: "Sophia", role: "student", at: 168, text: "Heat? And a strong base." },
  { speaker: "Imogen", role: "tutor", at: 176, text: "Both right. High temperature and a strong, bulky base — potassium tert-butoxide is the classic. A small strong nucleophile like ethoxide gives you more substitution." },
  { speaker: "Sophia", role: "student", at: 195, text: "So hydroxide in ethanol at reflux is elimination, and hydroxide in water is substitution." },
  { speaker: "Imogen", role: "tutor", at: 208, text: "That is the standard exam pair and you have it the right way round. Now Zaitsev. Which alkene forms?" },
  { speaker: "Sophia", role: "student", at: 221, text: "The more substituted one, because it's more stable." },
  { speaker: "Imogen", role: "tutor", at: 230, text: "Usually. The exception is a bulky base — tert-butoxide cannot reach the more hindered proton, so you get the less substituted alkene instead. That is Hofmann." },
  { speaker: "Sophia", role: "student", at: 248, text: "So the bulky base changes which product you get, not just the rate." },
  { speaker: "Imogen", role: "tutor", at: 259, text: "Correct. Let's test it: 2-bromo-2-methylbutane with sodium ethoxide, then the same substrate with potassium tert-butoxide." },
  { speaker: "Sophia", role: "student", at: 277, text: "Ethoxide gives the more substituted alkene, so 2-methylbut-2-ene. Tert-butoxide gives... 2-methylbut-1-ene." },
  { speaker: "Imogen", role: "tutor", at: 296, text: "Both right. Say why in the exam, though — the mark is for the reason, not the name. Where do you feel least sure after today?" },
  { speaker: "Sophia", role: "student", at: 312, text: "The anti-periplanar thing, and drawing Newman projections." },
  { speaker: "Imogen", role: "tutor", at: 322, text: "Then that is where to spend the week. Questions one to eight on elimination, and draw the Newman projection for every E2 answer even where the question does not ask for one." },
  { speaker: "Sophia", role: "student", at: 341, text: "One to eight, with Newman projections throughout. Got it." },
];

const MATHS_LINES: RawLine[] = [
  { speaker: "Daniel", role: "tutor", at: 20, text: "Induction. Three parts, and the marks are split across all three, so a beautiful algebraic step with no conclusion still loses marks." },
  { speaker: "Sophia", role: "student", at: 36, text: "Base case, assumption, then the inductive step." },
  { speaker: "Daniel", role: "tutor", at: 45, text: "And a concluding sentence. Let's prove that the sum of the first n cubes is n squared times n plus one squared, over four." },
  { speaker: "Sophia", role: "student", at: 62, text: "For n equals one: left side is one, right side is one times four over four, which is one. So it holds." },
  { speaker: "Daniel", role: "tutor", at: 79, text: "Now assume it for n equals k, and show it for k plus one. What are you adding to both sides?" },
  { speaker: "Sophia", role: "student", at: 93, text: "k plus one, cubed." },
  { speaker: "Daniel", role: "tutor", at: 100, text: "Good. Take a factor of k plus one squared out early — it saves you a page of expansion." },
  { speaker: "Sophia", role: "student", at: 114, text: "So k plus one squared, times k squared over four plus k plus one... which is k squared plus 4k plus 4 over four." },
  { speaker: "Daniel", role: "tutor", at: 136, text: "Which factorises to?" },
  { speaker: "Sophia", role: "student", at: 141, text: "k plus two, squared, over four. So it's the formula with k plus one substituted in." },
  { speaker: "Daniel", role: "tutor", at: 155, text: "And the conclusion sentence, in full, every time: true for n equals one, and true for k plus one whenever true for k, therefore true for all positive integers n by induction." },
];

export const DEMO_TRANSCRIPTS: Transcript[] = [
  {
    id: "tr-chem-8",
    lessonId: "l-chem-8",
    segments: toSegments(SN_LINES),
    provider: "demo",
    processingStatus: "ready",
    durationSeconds: 3480,
  },
  {
    id: "tr-chem-9",
    lessonId: "l-chem-9",
    segments: toSegments(E12_LINES),
    provider: "demo",
    processingStatus: "ready",
    durationSeconds: 3360,
  },
  {
    id: "tr-math-3",
    lessonId: "l-math-3",
    segments: toSegments(MATHS_LINES),
    provider: "demo",
    processingStatus: "ready",
    durationSeconds: 3300,
  },
];

/* -- notes ---------------------------------------------------------------- */

type NotesSeed = Omit<LessonNotesForTutor, "id" | "updatedAt"> & { updatedOffsetDays: number };

function notes(seed: NotesSeed): LessonNotesForTutor {
  const l = lesson(seed.lessonId);
  const updated = new Date(new Date(l.scheduledAt).getTime() + 90 * 60_000).toISOString();
  return { ...seed, id: `n-${seed.lessonId}`, updatedAt: updated };
}

const NOTE_SEEDS: NotesSeed[] = [
  {
    lessonId: "l-chem-8",
    summary:
      "We covered nucleophilic substitution in halogenoalkanes and, in particular, how to choose between SN1 and SN2 for a given reaction. You arrived already able to state the mechanistic difference, so the lesson concentrated on the selection criteria: substrate class, nucleophile strength and solvent. By the end you were working through 1-bromobutane with cyanide in DMSO unprompted and giving all three reasons for SN2, including inversion of configuration.",
    topicsCovered: [
      "SN1 and SN2 mechanisms",
      "Carbocation stability",
      "Steric hindrance to backside attack",
      "Rate equations for each mechanism",
      "Polar protic and polar aprotic solvents",
      "Leaving group ability",
    ],
    keyConcepts: [
      "SN2 is a single concerted step; SN1 proceeds through a carbocation intermediate",
      "Tertiary substrates favour SN1 for two independent reasons: a more stable carbocation and steric blocking of backside attack",
      "Polar protic solvents stabilise the SN1 intermediate but cage and blunt the nucleophile, which slows SN2",
      "Polar aprotic solvents dissolve the salt without hydrogen bonding to the anion, leaving the nucleophile reactive",
      "A better leaving group accelerates both mechanisms, so it cannot be used to decide between them",
    ],
    strengths: [
      "You gave the full SN1 mechanism for 2-bromo-2-methylpropane including the final deprotonation step, which is commonly left out",
      "You reasoned from the rate equation to which species appears in the slow step rather than recalling it",
      "By the end of the lesson you were justifying your choice with substrate, nucleophile and solvent together, in that order",
    ],
    areasForImprovement: [
      "Protic versus aprotic solvents: you needed a prompt to connect the solvent to the nucleophile rather than to the substrate",
      "Nucleophile strength was not yet being used as an independent factor in your reasoning",
    ],
    misconceptions: [
      "Earlier in the lesson the leaving group was used as evidence for SN1. It affects the rate of both mechanisms and does not select between them — you identified this yourself once it was raised.",
    ],
    homework: [
      "Substitution problem set, questions 4 to 12",
      "Draw question 12 with full curly arrows, paying attention to where each arrow starts",
    ],
    resourcesMentioned: [
      "Substitution problem set (uploaded to this lesson)",
      "Lesson board: SN1 vs SN2 decision flow",
    ],
    nextSteps: [
      "Elimination reactions, E1 and E2, and how they compete with substitution",
      "Revisit the solvent argument at the start of next lesson to check it has held",
    ],
    tutorPrivateNotes:
      "Sophia is quick but reaches for pattern recall before reasoning; when pushed for a mechanism she gets there every time. Keep asking 'why' twice rather than accepting the first answer. She mentioned losing marks on the last school paper for exactly the leaving-group error — worth checking she has corrected that paper rather than filed it.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -14,
  },
  {
    lessonId: "l-chem-9",
    summary:
      "This lesson introduced elimination — E1 and E2 — alongside the substitution mechanisms already covered, and worked on deciding between substitution and elimination for a given set of conditions. The solvent reasoning from the previous lesson was checked at the start and had held without prompting. The new material that needs consolidation is the anti-periplanar geometry required for E2 and the Newman projections used to show it.",
    topicsCovered: [
      "E1 and E2 mechanisms",
      "Anti-periplanar geometry",
      "Newman projections",
      "Substitution versus elimination conditions",
      "Zaitsev and Hofmann products",
    ],
    keyConcepts: [
      "E1 shares its first step with SN1; the carbocation is then deprotonated at the beta carbon rather than attacked",
      "E2 is concerted and requires the beta hydrogen and the leaving group to be anti-periplanar, at 180 degrees",
      "Heat and a strong base push toward elimination; a small strong nucleophile in a polar solvent pushes toward substitution",
      "A bulky base such as potassium tert-butoxide gives the Hofmann product rather than the Zaitsev product because it cannot reach the more hindered proton",
    ],
    strengths: [
      "The polar protic and aprotic distinction from last lesson was recalled correctly and unprompted at the start",
      "You predicted both products for 2-bromo-2-methylbutane correctly, with ethoxide and with tert-butoxide",
      "You identified without prompting that a bulky base changes the product rather than only the rate",
    ],
    areasForImprovement: [
      "Drawing Newman projections from a skeletal structure — you raised this yourself as the least secure part of the lesson",
      "Anti-periplanar geometry needs practice in ring systems, where it determines the product",
    ],
    misconceptions: [],
    homework: [
      "Elimination problem set, questions 1 to 8",
      "Draw a Newman projection for every E2 answer, including where the question does not ask for one",
    ],
    resourcesMentioned: ["Elimination problem set", "Lesson board: E1/E2 and the anti-periplanar requirement"],
    nextSteps: [
      "Reaction pathways: combining substitution, elimination and addition into synthesis routes",
      "Short recap of anti-periplanar geometry using a cyclohexane example",
    ],
    tutorPrivateNotes:
      "Draft from the notetaker, lightly checked but not yet corrected — the Newman projection point is understated relative to how much she struggled with it in the second half. Consider setting a separate short exercise on projections before the next lesson rather than folding it into the problem set.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: false,
    updatedOffsetDays: -2,
  },
  {
    lessonId: "l-chem-7",
    summary:
      "Functional groups and IUPAC nomenclature across the HL organic syllabus, then homologous series and their physical trends. Naming was secure by the end of the lesson, including branched chains and multiple substituents.",
    topicsCovered: ["Functional groups", "IUPAC nomenclature", "Homologous series", "Structural isomerism"],
    keyConcepts: [
      "Priority order of functional groups when choosing the parent chain",
      "Boiling point trends follow chain length and the strength of intermolecular forces",
    ],
    strengths: [
      "Named branched-chain compounds with multiple substituents accurately and without hesitation",
      "Explained boiling point trends from intermolecular forces rather than from memorised order",
    ],
    areasForImprovement: ["Cyclic compound naming was slower and needs a second pass"],
    misconceptions: [],
    homework: ["Nomenclature worksheet, all questions"],
    resourcesMentioned: ["Nomenclature worksheet"],
    nextSteps: ["Nucleophilic substitution: SN1 and SN2"],
    tutorPrivateNotes: "Comfortable session. Ready to move to mechanisms.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -21,
  },
  {
    lessonId: "l-chem-6",
    summary:
      "Oxidation numbers, half-equations and electrochemical cells. Half-equations in acidic conditions were the focus, and balancing improved noticeably over the hour.",
    topicsCovered: ["Oxidation numbers", "Half-equations", "Voltaic and electrolytic cells", "Cell potentials"],
    keyConcepts: [
      "Balance atoms, then oxygen with water, then hydrogen with H+, then charge with electrons",
      "Cell potential is the difference between the two standard electrode potentials",
    ],
    strengths: ["Assigned oxidation numbers reliably, including in polyatomic ions"],
    areasForImprovement: [
      "Balancing half-equations in alkaline conditions",
      "Identifying the anode and cathode in electrolytic rather than voltaic cells",
    ],
    misconceptions: [
      "The sign convention for the anode was initially carried over from voltaic cells into electrolytic cells.",
    ],
    homework: ["Redox questions 1 to 15", "Two past-paper cell potential calculations"],
    resourcesMentioned: ["Redox summary sheet"],
    nextSteps: ["Organic chemistry: functional groups and nomenclature"],
    tutorPrivateNotes: "Alkaline half-equations will need revisiting before the mock.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -28,
  },
  {
    lessonId: "l-chem-5",
    summary:
      "Acid–base equilibria: pH and pOH, weak acid calculations using Ka, and buffer behaviour. The Henderson–Hasselbalch approach was introduced and used on two worked examples.",
    topicsCovered: ["pH and pOH", "Ka and pKa", "Weak acid calculations", "Buffers"],
    keyConcepts: [
      "A weak acid calculation assumes dissociation is small relative to the initial concentration",
      "A buffer resists pH change because both the weak acid and its conjugate base are present in quantity",
    ],
    strengths: ["Rearranged the Ka expression confidently", "Explained buffer action in terms of Le Chatelier's principle"],
    areasForImprovement: ["Recognising when the small-dissociation approximation is not valid"],
    misconceptions: [],
    homework: ["Buffer calculations, questions 1 to 10"],
    resourcesMentioned: ["Acids and bases data booklet pages"],
    nextSteps: ["Redox and electrochemical cells"],
    tutorPrivateNotes: "Strong session. Approximation validity is the only gap.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -35,
  },
  {
    lessonId: "l-chem-4",
    summary:
      "Dynamic equilibrium, the equilibrium constant, and Le Chatelier's principle applied to pressure, concentration and temperature changes.",
    topicsCovered: ["Dynamic equilibrium", "Equilibrium constant Kc", "Le Chatelier's principle"],
    keyConcepts: ["Only temperature changes the value of Kc", "A catalyst changes the rate to equilibrium, not the position of it"],
    strengths: ["Applied Le Chatelier's principle correctly to all three variable types"],
    areasForImprovement: ["Writing Kc expressions for heterogeneous equilibria"],
    misconceptions: ["A catalyst was initially thought to shift the position of equilibrium."],
    homework: ["Equilibrium problem set, section B"],
    resourcesMentioned: [],
    nextSteps: ["Acids and bases"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -42,
  },
  {
    lessonId: "l-chem-3",
    summary: "Enthalpy changes, Hess's law cycles and bond enthalpy calculations, with attention to sign conventions.",
    topicsCovered: ["Enthalpy change", "Hess's law", "Bond enthalpies", "Calorimetry"],
    keyConcepts: ["Hess's law follows from enthalpy being a state function", "Bond breaking is endothermic; bond making is exothermic"],
    strengths: ["Constructed Hess cycles independently"],
    areasForImprovement: ["Sign errors when reversing a reaction in a cycle"],
    misconceptions: [],
    homework: ["Hess's law questions 1 to 8"],
    resourcesMentioned: [],
    nextSteps: ["Equilibrium"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -49,
  },
  {
    lessonId: "l-chem-2",
    summary: "Ionic, covalent and metallic bonding, then intermolecular forces and their effect on physical properties.",
    topicsCovered: ["Ionic bonding", "Covalent bonding", "Metallic bonding", "Intermolecular forces", "VSEPR"],
    keyConcepts: ["Hydrogen bonding requires N, O or F", "VSEPR predicts shape from electron domain count and lone pairs"],
    strengths: ["Predicted molecular shapes accurately using VSEPR"],
    areasForImprovement: ["Distinguishing bond polarity from overall molecular polarity"],
    misconceptions: ["Polar bonds were initially taken to imply a polar molecule regardless of symmetry."],
    homework: ["Bonding worksheet, all questions"],
    resourcesMentioned: [],
    nextSteps: ["Energetics"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -56,
  },
  {
    lessonId: "l-chem-1",
    summary: "First lesson. Diagnostic across atomic structure and periodicity, establishing where the course would start.",
    topicsCovered: ["Atomic structure", "Electron configuration", "Periodic trends", "Ionisation energy"],
    keyConcepts: ["Periodic trends follow nuclear charge, shielding and atomic radius"],
    strengths: ["Electron configurations were accurate, including exceptions"],
    areasForImprovement: ["Explaining successive ionisation energy jumps in terms of shell structure"],
    misconceptions: [],
    homework: ["Periodicity questions 1 to 6"],
    resourcesMentioned: [],
    nextSteps: ["Bonding and intermolecular forces"],
    tutorPrivateNotes: "Diagnostic suggests a strong DP2 student with gaps in explanation rather than recall.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -63,
  },
  {
    lessonId: "l-math-3",
    summary:
      "Proof by induction: structure, common mark allocations and two worked proofs. The algebra was accurate throughout; the concluding statement is what needs to become automatic.",
    topicsCovered: ["Proof by induction", "Summation formulae", "Divisibility proofs"],
    keyConcepts: [
      "Marks are split across base case, inductive step and conclusion",
      "Factorising early in the inductive step avoids most of the algebra",
    ],
    strengths: ["Spotted the common factor early and kept the algebra short", "Base case was stated properly rather than asserted"],
    areasForImprovement: ["Writing the concluding sentence in full every time"],
    misconceptions: [],
    homework: ["Induction exercise 6A, questions 1 to 10"],
    resourcesMentioned: ["Induction structure sheet"],
    nextSteps: ["Complex numbers and De Moivre's theorem"],
    tutorPrivateNotes: "Algebra is not the issue. Exam presentation is.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -9,
  },
  {
    lessonId: "l-math-2",
    summary: "Integration by substitution, including recognising when a substitution is the right approach and how to handle limits.",
    topicsCovered: ["Integration by substitution", "Definite integrals with substitution"],
    keyConcepts: ["Change the limits when substituting rather than converting back"],
    strengths: ["Chose sensible substitutions without prompting"],
    areasForImprovement: ["Remembering to change the limits on definite integrals"],
    misconceptions: [],
    homework: ["Exercise 5C, odd numbered questions"],
    resourcesMentioned: [],
    nextSteps: ["Proof by induction"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -16,
  },
  {
    lessonId: "l-math-1",
    summary: "Differentiation rules — chain, product and quotient — and how to identify which is needed from the structure of the function.",
    topicsCovered: ["Chain rule", "Product rule", "Quotient rule"],
    keyConcepts: ["Read the structure of the function before choosing a rule"],
    strengths: ["Applied the chain rule confidently on nested functions"],
    areasForImprovement: ["Quotient rule sign errors"],
    misconceptions: [],
    homework: ["Exercise 4B, questions 1 to 12"],
    resourcesMentioned: [],
    nextSteps: ["Integration by substitution"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -30,
  },
  {
    lessonId: "l-alevel-1",
    summary: "Rate equations, orders of reaction and determining orders from initial rate data.",
    topicsCovered: ["Rate equations", "Orders of reaction", "Initial rates method", "Rate-determining step"],
    keyConcepts: ["The rate equation reflects the rate-determining step, not the overall equation"],
    strengths: ["Determined orders from tabulated initial rate data accurately"],
    areasForImprovement: ["Deducing a mechanism consistent with a given rate equation"],
    misconceptions: [],
    homework: ["Kinetics past paper questions, section A"],
    resourcesMentioned: [],
    nextSteps: ["Transition metals"],
    tutorPrivateNotes: "",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: true,
    updatedOffsetDays: -10,
  },
  {
    lessonId: "l-alevel-2",
    summary:
      "Transition metal chemistry: variable oxidation states, complex ion formation, ligand substitution and the origin of colour.",
    topicsCovered: ["Variable oxidation states", "Complex ions", "Ligand substitution", "Colour in transition metal complexes"],
    keyConcepts: ["Colour arises from d-orbital splitting and the absorption of visible light"],
    strengths: ["Drew octahedral and tetrahedral complexes correctly with the right coordination numbers"],
    areasForImprovement: ["Explaining the colour change during ligand substitution in terms of the splitting energy"],
    misconceptions: [],
    homework: ["Transition metals questions 1 to 12"],
    resourcesMentioned: [],
    nextSteps: ["Buffers and titration curves"],
    tutorPrivateNotes: "Draft — needs a pass before publishing.",
    aiGenerated: true,
    aiModel: "demo",
    tutorReviewed: false,
    updatedOffsetDays: -4,
  },
];

export const DEMO_NOTES: LessonNotesForTutor[] = NOTE_SEEDS.map(notes);

/* -- files ---------------------------------------------------------------- */

export const DEMO_FILES: LessonFile[] = [
  {
    id: "f-1",
    lessonId: "l-chem-8",
    fileName: "SN1-vs-SN2-board.png",
    fileType: "image/png",
    fileSize: 486_000,
    category: "board",
    createdAt: lesson("l-chem-8").endedAt ?? lesson("l-chem-8").scheduledAt,
    url: null,
  },
  {
    id: "f-2",
    lessonId: "l-chem-8",
    fileName: "substitution-problem-set.pdf",
    fileType: "application/pdf",
    fileSize: 212_400,
    category: "worksheet",
    createdAt: lesson("l-chem-8").endedAt ?? lesson("l-chem-8").scheduledAt,
    url: null,
  },
  {
    id: "f-3",
    lessonId: "l-chem-9",
    fileName: "E1-E2-anti-periplanar-board.png",
    fileType: "image/png",
    fileSize: 512_800,
    category: "board",
    createdAt: lesson("l-chem-9").endedAt ?? lesson("l-chem-9").scheduledAt,
    url: null,
  },
  {
    id: "f-4",
    lessonId: "l-chem-9",
    fileName: "elimination-problem-set.pdf",
    fileType: "application/pdf",
    fileSize: 198_100,
    category: "worksheet",
    createdAt: lesson("l-chem-9").endedAt ?? lesson("l-chem-9").scheduledAt,
    url: null,
  },
  {
    id: "f-5",
    lessonId: "l-chem-6",
    fileName: "redox-summary-sheet.pdf",
    fileType: "application/pdf",
    fileSize: 154_300,
    category: "resource",
    createdAt: lesson("l-chem-6").endedAt ?? lesson("l-chem-6").scheduledAt,
    url: null,
  },
  {
    id: "f-6",
    lessonId: "l-math-3",
    fileName: "induction-structure.pdf",
    fileType: "application/pdf",
    fileSize: 88_900,
    category: "resource",
    createdAt: lesson("l-math-3").endedAt ?? lesson("l-math-3").scheduledAt,
    url: null,
  },
];

/* -- homework ------------------------------------------------------------- */

interface HomeworkSeed {
  id: string;
  lessonId: string;
  description: string;
  completed: boolean;
  dueOffsetDays?: number;
}

const HOMEWORK_SEEDS: HomeworkSeed[] = [
  { id: "h-1", lessonId: "l-chem-8", description: "Substitution problem set, questions 4 to 12", completed: false, dueOffsetDays: 2 },
  { id: "h-2", lessonId: "l-chem-8", description: "Draw question 12 with full curly arrows, paying attention to where each arrow starts", completed: false, dueOffsetDays: 2 },
  { id: "h-3", lessonId: "l-chem-7", description: "Nomenclature worksheet, all questions", completed: true },
  { id: "h-4", lessonId: "l-chem-6", description: "Redox questions 1 to 15", completed: true },
  { id: "h-5", lessonId: "l-chem-6", description: "Two past-paper cell potential calculations", completed: true },
  { id: "h-6", lessonId: "l-chem-5", description: "Buffer calculations, questions 1 to 10", completed: true },
  { id: "h-7", lessonId: "l-math-3", description: "Induction exercise 6A, questions 1 to 10", completed: false, dueOffsetDays: 4 },
  { id: "h-8", lessonId: "l-math-2", description: "Exercise 5C, odd numbered questions", completed: true },
  { id: "h-9", lessonId: "l-alevel-1", description: "Kinetics past paper questions, section A", completed: false, dueOffsetDays: 1 },
];

export const DEMO_HOMEWORK: HomeworkItem[] = HOMEWORK_SEEDS.map((seed) => {
  const l = lesson(seed.lessonId);
  const due =
    seed.dueOffsetDays === undefined
      ? null
      : new Date(Date.now() + seed.dueOffsetDays * 86_400_000).toISOString();
  return {
    id: seed.id,
    lessonId: seed.lessonId,
    studentId: l.studentId,
    subjectId: l.subjectId,
    description: seed.description,
    dueAt: due,
    completed: seed.completed,
    completedAt: seed.completed ? l.endedAt : null,
  };
});

/* -- progress -------------------------------------------------------------
   Mastery is an illustrative placeholder in V1 and the UI labels it as such.
   Nothing here is derived from a defensible measurement.
   ------------------------------------------------------------------------ */

interface ProgressSeed {
  studentId: string;
  subjectId: string;
  topic: string;
  mastery: number;
  evidence: number;
}

const PROGRESS_SEEDS: ProgressSeed[] = [
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Atomic structure and periodicity", mastery: 0.88, evidence: 3 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Bonding and intermolecular forces", mastery: 0.81, evidence: 4 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Energetics", mastery: 0.74, evidence: 2 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Equilibrium", mastery: 0.79, evidence: 3 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Acids and bases", mastery: 0.83, evidence: 3 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Redox and electrochemistry", mastery: 0.62, evidence: 2 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Organic: substitution", mastery: 0.77, evidence: 4 },
  { studentId: "s-sophia", subjectId: "sub-chem-hl", topic: "Organic: elimination", mastery: 0.55, evidence: 1 },
  { studentId: "s-sophia", subjectId: "sub-maths-aa-hl", topic: "Differentiation", mastery: 0.86, evidence: 3 },
  { studentId: "s-sophia", subjectId: "sub-maths-aa-hl", topic: "Integration", mastery: 0.71, evidence: 2 },
  { studentId: "s-sophia", subjectId: "sub-maths-aa-hl", topic: "Proof", mastery: 0.68, evidence: 2 },
  { studentId: "s-marcus", subjectId: "sub-chem-alevel", topic: "Kinetics", mastery: 0.72, evidence: 2 },
  { studentId: "s-marcus", subjectId: "sub-chem-alevel", topic: "Transition metals", mastery: 0.58, evidence: 1 },
];

export const DEMO_PROGRESS: TopicProgress[] = PROGRESS_SEEDS.map((seed, i) => ({
  id: `pr-${i + 1}`,
  studentId: seed.studentId,
  subjectId: seed.subjectId,
  topic: seed.topic,
  masteryScore: seed.mastery,
  confidence: 0.4,
  evidenceCount: seed.evidence,
  lastUpdated: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
}));

/* -- notifications -------------------------------------------------------- */

export const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: "nt-1",
    profileId: "p-imogen",
    kind: "lesson_notes_ready_for_review",
    title: "Lesson notes for Sophia Thompson are ready to review",
    body: "The AI draft is waiting. Nothing reaches the student until you publish it.",
    lessonId: "l-chem-9",
    readAt: null,
    createdAt: new Date(Date.now() - 2 * 86_400_000 + 5_400_000).toISOString(),
  },
  {
    id: "nt-2",
    profileId: "p-imogen",
    kind: "lesson_notes_ready_for_review",
    title: "Lesson notes for Marcus Adeyemi are ready to review",
    body: "The AI draft is waiting. Nothing reaches the student until you publish it.",
    lessonId: "l-alevel-2",
    readAt: null,
    createdAt: new Date(Date.now() - 4 * 86_400_000 + 5_400_000).toISOString(),
  },
  {
    id: "nt-3",
    profileId: "p-sophia",
    kind: "lesson_published",
    title: "Your IB Chemistry HL lesson notes have been published",
    body: "Organic chemistry: SN1 and SN2 mechanisms is ready to read.",
    lessonId: "l-chem-8",
    readAt: null,
    createdAt: new Date(Date.now() - 14 * 86_400_000 + 5_400_000).toISOString(),
  },
  {
    id: "nt-4",
    profileId: "p-sophia",
    kind: "lesson_scheduled",
    title: "A new Chemistry lesson has been scheduled",
    body: "Reaction pathways and synthesis routes.",
    lessonId: "l-chem-11",
    readAt: new Date(Date.now() - 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
];
