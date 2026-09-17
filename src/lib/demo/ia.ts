import type { IaReviewRecord, IaSubmission } from "@/lib/types";
import { PROMPT_VERSION } from "@/lib/ia/schema";

/* ==========================================================================
   A worked IA review, for demo mode
   --------------------------------------------------------------------------
   Invented, like everything else in the demo dataset: there is no such student
   and no such investigation.

   It is deliberately a FEEDBACK-ONLY review rather than a marked one, because
   that is what a deployment with no descriptors installed actually produces —
   which is every deployment today. A demo that showed 18/24 would be
   advertising a thing the product does not currently do, to the one audience
   who most needs to understand the difference.

   The content is written to show what the format is for: evidence pointed at
   specific pages, actions labelled by the work they require, and a
   verification log that states the limits of its own checks. The two-readings-
   as-replicates problem is the illustrative example from the Biology pack,
   reworked rather than quoted.
   ========================================================================== */

export const DEMO_IA_SUBMISSION: IaSubmission = {
  id: "iasub-demo",
  studentId: "s-sophia",
  subject: "biology",
  level: "HL",
  session: "May 2027",
  stage: "complete_draft",
  fileName: "Catalase-IA-draft3.pdf",
  fileSize: 1_842_003,
  fileHash: "9f2c1b7ae4d05c83b6110f7de2a4c9188bb0d3e7a5641f2c8e93a7b4d5c60e18",
  wordCount: 2418,
  studentNote:
    "I think my evaluation is the weakest part. Also not sure whether I was allowed to drop the run at 50 °C — the tube cracked.",
  status: "reviewed",
  failureNote: null,
  professionalReviewRequestedAt: null,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
};

export const DEMO_IA_REVIEW: IaReviewRecord = {
  id: "iarev-demo",
  submissionId: "iasub-demo",
  rubricId: "biology_fa2025",
  packVersion: null,
  mode: "feedback_only",
  calibrationStatus: "uncalibrated",
  total: null,
  maxTotal: 24,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  body: {
    subject: "biology",
    level: "HL",
    session: "May 2027",
    stage: "complete_draft",
    rubricId: "biology_fa2025",
    rubricName: "Biology scientific investigation (first assessment 2025)",
    mode: "feedback_only",
    calibrationStatus: "uncalibrated",
    modeReasons: [
      "We do not yet hold the official Biology scientific investigation (first assessment 2025) achievement descriptors, so this review is written feedback against the published criteria rather than a mark. Reconstructing IB's bands from memory or from a revision website would produce a number that looks authoritative and is not.",
    ],
    assessmentPackVersion: null,
    assessmentPackChecksum: null,
    modelId: "gpt-4.1",
    promptVersion: PROMPT_VERSION,
    documentHash: DEMO_IA_SUBMISSION.fileHash,
    total: null,
    maxTotal: 24,
    humanReviewReasons: [
      "The excluded 50 °C run is described in the method but its data do not appear anywhere in the report, so we cannot tell whether removing it changed the shape of the curve. A tutor should look at the raw figures.",
    ],
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    assessment: {
      report_title:
        "The effect of temperature on the rate of catalase activity in potato tissue",
      overview:
        "You have a clear, answerable question and your processing is careful — the rate calculation is right, and you have been honest about the run you discarded. The two things holding this back are both about the sampling rather than the chemistry: it is not yet clear how many separate potatoes you used, and your evaluation names limitations without saying which of them would actually have moved your result.",
      criteria: [
        {
          id: "research_design",
          mark: null,
          rationale: null,
          not_assessed_reason:
            "Marks are withheld for this review — the official descriptors were not available.",
          strengths: [
            "The question names the variable, the range and the tissue, so a reader knows what was tested without reading the method.",
            "Controlled variables are listed with the value each was held at, not just named.",
          ],
          limiting: [
            "The number of separate potatoes is never stated, so a reader cannot tell whether your five readings at each temperature came from five potatoes or from one.",
            "The buffer is named but its pH is not given anywhere, and catalase activity is strongly pH-dependent.",
          ],
          evidence: [
            {
              location: "p. 3, Method step 4",
              excerpt: "Five readings were taken at each temperature.",
              observation:
                "This is the only place the replicate count appears, and it does not say what was replicated — the measurement, the tissue sample, or the potato.",
            },
            {
              location: "p. 2, Controlled variables",
              excerpt: "Buffer solution kept constant throughout.",
              observation:
                "Named as controlled, but the value it was held at is not recorded, so the investigation could not be repeated as written.",
            },
          ],
          actions: [
            {
              action:
                "State how many potatoes you used, how many discs came from each, and which readings came from the same disc. If all your replicates came from one potato, say so — it is a limitation you can then discuss, not a mistake.",
              work_type: "clarify",
              completion_check:
                "Someone reading only your method can say how many independent biological samples you had.",
              location: "p. 3, Method step 4",
            },
            {
              action: "Add the pH of the buffer to your controlled variables table.",
              work_type: "clarify",
              completion_check: "The table gives a number, not just the word 'buffer'.",
              location: "p. 2",
            },
          ],
        },
        {
          id: "data_analysis",
          mark: null,
          rationale: null,
          not_assessed_reason:
            "Marks are withheld for this review — the official descriptors were not available.",
          strengths: [
            "Raw and processed data are separate tables, and the processing is shown rather than only its result.",
            "Your rate calculation at 30 °C is arithmetically correct — we re-did it.",
          ],
          limiting: [
            "The error bars on Figure 2 are not defined, so it is not possible to tell what spread they show.",
            "If your five readings came from one potato, the statistics treat repeated measurements as independent samples, which would overstate how much evidence you have.",
          ],
          evidence: [
            {
              location: "p. 6, Figure 2",
              excerpt: "Mean rate of oxygen production against temperature, with error bars.",
              observation:
                "The caption does not say whether the bars are standard deviation, standard error, or the range.",
            },
            {
              location: "p. 5, Table 3",
              excerpt: "Mean rate (cm³ s⁻¹) with standard deviation across five readings.",
              observation:
                "Standard deviation is calculated across the five readings, which is only a measure of biological variation if those five came from five different potatoes.",
            },
          ],
          actions: [
            {
              action:
                "Say in the caption of Figure 2 exactly what the error bars represent, and make sure it is the same quantity as the one in Table 3.",
              work_type: "clarify",
              completion_check:
                "The caption names the statistic, and the number in it matches the table.",
              location: "p. 6, Figure 2",
            },
            {
              action:
                "Once you have settled how many potatoes were involved, check whether your standard deviation is describing variation between potatoes or repeated readings of one. If it is the latter, recalculate at the level of the potato and see whether your conclusion still holds.",
              work_type: "reanalyse",
              completion_check:
                "You can say what your n actually is, and the figure's error bars are calculated at that level.",
              location: "p. 5, Table 3",
            },
          ],
        },
        {
          id: "conclusion",
          mark: null,
          rationale: null,
          not_assessed_reason:
            "Marks are withheld for this review — the official descriptors were not available.",
          strengths: [
            "You describe the shape of the curve rather than only its peak, which is the more interesting half of the result.",
            "The denaturation explanation is linked to the data you actually collected, not asserted from the textbook.",
          ],
          limiting: [
            "The optimum is given as 40 °C, but you only tested at ten-degree intervals, so what you can say is that it lies between 30 °C and 50 °C.",
            "The literature comparison cites an optimum for a different source of catalase without noting that it is a different source.",
          ],
          evidence: [
            {
              location: "p. 8, ¶2",
              excerpt: "The optimum temperature for catalase in potato is therefore 40 °C.",
              observation:
                "The interval between your tested temperatures is wider than the precision this claim implies.",
            },
          ],
          actions: [
            {
              action:
                "Rephrase the optimum as an interval your data can support, and say what you would need to narrow it.",
              work_type: "clarify",
              completion_check:
                "The sentence states a range, and the resolution of your temperature series is given as the reason.",
              location: "p. 8, ¶2",
            },
            {
              action:
                "Check whether the literature value you compare against is for potato catalase or another source, and say which in the text.",
              work_type: "clarify",
              completion_check:
                "The comparison names the organism, and says whether it is the same as yours.",
              location: "p. 8, ¶4",
            },
          ],
        },
        {
          id: "evaluation",
          mark: null,
          rationale: null,
          not_assessed_reason:
            "Marks are withheld for this review — the official descriptors were not available.",
          strengths: [
            "You say plainly that you discarded the 50 °C run and why, which is the right instinct and better than quietly dropping it.",
          ],
          limiting: [
            "Three limitations are listed but none is weighed: a reader cannot tell which of them you think actually affected your result.",
            "The improvements are generic — 'use a water bath' and 'repeat more times' would improve almost any investigation and are not answers to the specific weaknesses you named.",
            "The discarded run is mentioned but its data are not shown, so the effect of removing it cannot be judged.",
          ],
          evidence: [
            {
              location: "p. 9, Limitations",
              excerpt:
                "Sources of error included temperature fluctuation, timing by hand, and variation between potato discs.",
              observation:
                "All three are plausible. None is given a direction or a relative size, so the list does not yet distinguish the one that mattered from the two that probably did not.",
            },
            {
              location: "p. 9, ¶3",
              excerpt: "The 50 °C trial was excluded as the boiling tube cracked.",
              observation:
                "The exclusion is declared, which is right, but the readings taken before the tube cracked are not reported anywhere.",
            },
          ],
          actions: [
            {
              action:
                "For each of your three limitations, say which direction it would push your measured rate and roughly how much compared with the others. If you do not know the size, say that — an honest 'I cannot tell which of these dominated' is worth more than three equal-looking bullet points.",
              work_type: "clarify",
              completion_check:
                "Each limitation has a direction and a comparison to the other two.",
              location: "p. 9",
            },
            {
              action:
                "Put the readings you did get from the 50 °C run in an appendix, with a note that the tube cracked partway through. Then say whether including them would have changed the shape of your curve.",
              work_type: "reanalyse",
              completion_check:
                "The excluded data are visible, and you have stated what difference they would have made.",
              location: "p. 9, ¶3",
            },
          ],
        },
      ],
      priorities: [
        {
          title: "Settle how many potatoes your replicates came from",
          why: "It decides whether your error bars and your standard deviation describe biological variation or repeated readings of the same tissue — which changes how strong your evidence actually is. Everything in Data analysis depends on the answer.",
          criterion_id: "data_analysis",
          work_type: "clarify",
        },
        {
          title: "Weigh your three limitations against each other",
          why: "A list of plausible errors with no relative sizes is the most common thing that holds an evaluation back, and you already have everything you need to do it.",
          criterion_id: "evaluation",
          work_type: "clarify",
        },
        {
          title: "Report the 50 °C data you did collect",
          why: "You were right to exclude the run and right to say so. Showing what you had lets a reader see that the exclusion did not create your result.",
          criterion_id: "evaluation",
          work_type: "reanalyse",
        },
        {
          title: "State the optimum as a range",
          why: "Your conclusion currently claims more precision than a ten-degree interval can support.",
          criterion_id: "conclusion",
          work_type: "clarify",
        },
      ],
      verification_checks: [
        {
          what: "Rate calculation at 30 °C, Table 3 row 2",
          inputs: "Volume 4.8 cm³ of O₂, time 60 s",
          method: "Re-computed 4.8 / 60 and compared with the reported figure",
          result: "0.080 cm³ s⁻¹, matching the value in the table",
          scope:
            "This one row only. The other nine rows of Table 3 were not recalculated, so this says nothing about them.",
          status: "confirmed",
        },
        {
          what: "Standard deviation reported for the 30 °C readings",
          inputs: "The five readings listed in Table 2",
          method: "Re-computed the sample standard deviation from the raw readings",
          result:
            "0.006 against a reported 0.006. The arithmetic agrees; whether it is the right statistic depends on the sampling question above.",
          scope:
            "Arithmetic only. This does not check that a standard deviation across these five values means what the report says it means.",
          status: "confirmed",
        },
        {
          what: "Literature optimum cited on p. 8",
          inputs: "The reference given in the bibliography",
          method: "Not checked — the source was not available to this review",
          result: "Unverified",
          scope: "The claim may be correct; we simply did not read the source.",
          status: "unverified",
        },
      ],
      input_warnings: [],
      human_review_reasons: [
        "The excluded 50 °C run is described in the method but its data do not appear anywhere in the report, so we cannot tell whether removing it changed the shape of the curve. A tutor should look at the raw figures.",
      ],
      questions_for_student: [
        "How many separate potatoes did the discs come from, and were the five readings at each temperature from the same disc?",
        "What pH was the buffer?",
        "Do you still have the readings from the 50 °C run before the tube cracked?",
      ],
    },
  },
};
