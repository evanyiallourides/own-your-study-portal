import type { LessonStatus, MeetingPlatform } from "@/lib/types";

export type StatusTone = "neutral" | "info" | "accent" | "warning" | "success" | "danger";

interface StatusPresentation {
  label: string;
  tone: StatusTone;
  /** Shown to the *student*. Never mentions the review queue — a student does
   *  not need to know their tutor has a draft open. */
  studentDetail: string;
  /** Shown to tutors and admins, where the pipeline stage is the useful fact. */
  staffDetail: string;
}

export const LESSON_STATUS: Record<LessonStatus, StatusPresentation> = {
  scheduled: {
    label: "Scheduled",
    tone: "info",
    studentDetail: "This lesson has not happened yet.",
    staffDetail: "Booked. The notetaker joins automatically if it is enabled and consent is recorded.",
  },
  in_progress: {
    label: "In progress",
    tone: "accent",
    studentDetail: "This lesson is happening now.",
    staffDetail: "Live now.",
  },
  processing_transcript: {
    label: "Processing transcript",
    tone: "neutral",
    studentDetail: "Your notes are being prepared.",
    staffDetail: "The recording is being turned into a speaker-labelled transcript.",
  },
  generating_notes: {
    label: "Generating notes",
    tone: "neutral",
    studentDetail: "Your notes are being prepared.",
    staffDetail: "The transcript is being analysed. A draft will follow for you to review.",
  },
  review_required: {
    label: "Review required",
    tone: "warning",
    studentDetail: "Your notes are being prepared.",
    staffDetail: "A draft is waiting for you. Nothing reaches the student until you publish it.",
  },
  published: {
    label: "Published",
    tone: "success",
    studentDetail: "Notes, transcript and resources are available.",
    staffDetail: "Visible to the student, with the notes, transcript and any resources.",
  },
  failed: {
    label: "Needs attention",
    tone: "danger",
    studentDetail: "Notes are not available for this lesson.",
    staffDetail: "Processing did not complete. The lesson can still be written up by hand.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    studentDetail: "This lesson did not go ahead.",
    staffDetail: "Cancelled.",
  },
};

/* One source of truth, defined beside the parser that detects the platform in
   the first place. Re-exported here so the status vocabulary stays in one
   import for the pages that use it. */
export { MEETING_PLATFORM_LABEL as PLATFORM_LABEL } from "@/lib/meetings/links";

/** The statuses a tutor's review queue is built from. */
export const NEEDS_REVIEW: LessonStatus[] = ["review_required"];

/** In-flight, as far as a person is concerned. */
export const PROCESSING: LessonStatus[] = ["processing_transcript", "generating_notes"];
