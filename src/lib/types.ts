/* ==========================================================================
   Portal domain types
   --------------------------------------------------------------------------
   Deliberately not the database row shapes. The dashboards work in terms of
   people and lessons; mapping snake_case rows onto these happens once, in the
   Supabase repository, so a schema change touches one file rather than fifty
   components.
   ========================================================================== */

/* The one import in this file. lib/ia/ does not import back, so there is no
   cycle — and it is type-only in any case, so nothing survives compilation. */
import type { IaReview } from "@/lib/ia/schema";

export const USER_ROLES = ["student", "tutor", "admin", "parent"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LESSON_STATUSES = [
  "scheduled",
  "in_progress",
  "processing_transcript",
  "generating_notes",
  "review_required",
  "published",
  "failed",
  "cancelled",
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const MEETING_PLATFORMS = ["google_meet", "zoom", "teams", "other"] as const;
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number];

export const FILE_CATEGORIES = ["board", "worksheet", "homework", "resource", "other"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
  active: boolean;
}

export interface StudentConsent {
  aiNotetakerConsent: boolean;
  transcriptionConsent: boolean;
  guardianConsentRequired: boolean;
  guardianConsentReceived: boolean;
  consentTimestamp: string | null;
}

export interface Student {
  id: string;
  profileId: string;
  profile: Profile;
  programme: string | null;
  yearLevel: string | null;
  school: string | null;
  timezone: string;
  transcriptAccessEnabled: boolean;
  consent: StudentConsent;
}

/**
 * Whether a student may read the full question banks, and why.
 *
 * `source` matters to the interface as much as `granted` does: "included with
 * your 24 pooled hours" and "your subscription runs to March" are different
 * sentences, and an administrator looking at a student needs to know which of
 * the two they are looking at before changing anything.
 */
export interface QuestionBankAccess {
  granted: boolean;
  source: "subscription" | "pooled-hours" | "none";
  expiresAt: string | null;
  note: string | null;
  grantedAt: string | null;
  /** Hours booked and not cancelled, and the threshold they are measured against. */
  pooledHours: number;
  freeAtHours: number;
  /** True when a subscription row exists at all, expired or not. */
  hasSubscriptionRow: boolean;
}

/* ==========================================================================
   Orders
   --------------------------------------------------------------------------
   What somebody bought, and whether we have worked out who they are yet.

   The awkward part is `student`. Buyers arrive from a static marketing site
   with no account, so at the moment money arrives there is often nobody to
   attach it to. An order with no student is not an error — it is the queue an
   administrator works through, and it is the only part of this screen that
   asks for a human.
   ========================================================================== */

export const ORDER_STATUSES = [
  "pending",
  "authorised",
  "paid",
  "instalments_active",
  "past_due",
  "completed",
  "refunded",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderPayment {
  id: string;
  kind: "payment" | "refund" | "failure" | "dispute";
  /** Minor units of the order's own currency. Never converted. */
  amountMinor: number;
  currency: string;
  occurredAt: string;
  detail: string | null;
}

export interface Order {
  id: string;
  provider: string;
  skuSlug: string;
  /** Snapshotted at purchase, so renaming a package does not rewrite history. */
  skuName: string;
  plan: "full" | "instalments";
  quantity: number;
  instalmentMonths: number | null;
  instalmentsPaid: number;
  currency: string;
  amountTotalMinor: number;
  amountPaidMinor: number;
  taxAmountMinor: number;
  status: OrderStatus;
  buyerEmail: string;
  buyerName: string | null;
  buyerCountry: string | null;
  sourceSite: string | null;
  /** Null when nobody has been matched to this payment yet. */
  studentId: string | null;
  studentName: string | null;
  claimedAt: string | null;
  note: string | null;
  createdAt: string;
  grantsQuestionBankDays: number | null;
}

/**
 * Money taken and held, with nobody to give it to.
 *
 * The statuses excluded are the ones where attaching a student would achieve
 * nothing: a checkout that was never finished, one that was cancelled, and a
 * refund — the money has gone back, so there is no entitlement left to grant
 * and putting it in an administrator's queue is just noise.
 */
export function isUnmatched(order: Order): boolean {
  if (order.studentId !== null) return false;
  return !CONCLUDED_WITHOUT_ENTITLEMENT.includes(order.status);
}

const CONCLUDED_WITHOUT_ENTITLEMENT: OrderStatus[] = ["pending", "cancelled", "refunded"];

export function isInstalmentPlanRunning(order: Order): boolean {
  return order.status === "instalments_active" || order.status === "past_due";
}

export function needsAttention(order: Order): boolean {
  return (
    isUnmatched(order) ||
    order.status === "past_due" ||
    order.status === "refunded"
  );
}

export interface Tutor {
  id: string;
  profileId: string;
  profile: Profile;
  bio: string | null;
  headline: string | null;
  active: boolean;
}

export interface Parent {
  id: string;
  profileId: string;
  profile: Profile;
}

export interface Subject {
  id: string;
  name: string;
  curriculum: string;
  level: string | null;
  division: string | null;
  archived: boolean;
  /** "IB Chemistry HL" — what a person calls it. */
  displayName: string;
}

export interface Assignment {
  id: string;
  tutorId: string;
  studentId: string;
  subjectId: string;
  active: boolean;
  createdAt: string;
  tutor?: Tutor;
  student?: Student;
  subject?: Subject;
}

export interface Lesson {
  id: string;
  studentId: string;
  tutorId: string;
  subjectId: string;
  title: string | null;
  scheduledAt: string;
  durationMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  meetingUrl: string | null;
  meetingPlatform: MeetingPlatform;
  status: LessonStatus;
  published: boolean;
  publishedAt: string | null;
  notetakerEnabled: boolean;
  recallBotId: string | null;
  processingError: string | null;

  /* Google Calendar, when the link was created by the portal rather than
     pasted in. `meetLinkManaged` is the one the interface reads: a pasted link
     is not ours to move or revoke and should not be presented as if it were. */
  googleEventId: string | null;
  googleCalendarId: string | null;
  meetLinkManaged: boolean;
}

/** A lesson with the three things you always need beside it. */
export interface LessonWithContext extends Lesson {
  subject: Subject;
  tutor: Tutor;
  student: Student;
  hasNotes: boolean;
  hasTranscript: boolean;
  fileCount: number;
}

export interface TranscriptSegment {
  index: number;
  speaker: string;
  role: "tutor" | "student" | "other";
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface Transcript {
  id: string;
  lessonId: string;
  segments: TranscriptSegment[];
  provider: string;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  durationSeconds: number | null;
}

/** The student-safe projection. Note the absence of tutorPrivateNotes — this
 *  shape is what the student routes are typed against, so the private field
 *  cannot be rendered there even by mistake. */
export interface LessonNotes {
  id: string;
  lessonId: string;
  summary: string | null;
  topicsCovered: string[];
  keyConcepts: string[];
  strengths: string[];
  areasForImprovement: string[];
  misconceptions: string[];
  homework: string[];
  resourcesMentioned: string[];
  nextSteps: string[];
  aiGenerated: boolean;
  aiModel: string | null;
  tutorReviewed: boolean;
  updatedAt: string;
}

/** Everything above plus the tutor's own margin notes. Only tutor and admin
 *  routes ever ask for this type. */
export interface LessonNotesForTutor extends LessonNotes {
  tutorPrivateNotes: string | null;
}

export interface LessonFile {
  id: string;
  lessonId: string;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  category: FileCategory;
  createdAt: string;
  /** Signed and short-lived. Never persisted. */
  url: string | null;
}

export interface HomeworkItem {
  id: string;
  lessonId: string;
  studentId: string;
  subjectId: string;
  description: string;
  dueAt: string | null;
  completed: boolean;
  completedAt: string | null;
  subject?: Subject;
  lessonTitle?: string | null;
}

export interface TopicProgress {
  id: string;
  studentId: string;
  subjectId: string;
  topic: string;
  masteryScore: number | null;
  confidence: number | null;
  evidenceCount: number;
  lastUpdated: string;
}

export interface Notification {
  id: string;
  profileId: string;
  kind:
    | "lesson_notes_ready_for_review"
    | "lesson_published"
    | "lesson_scheduled"
    | "transcript_failed";
  title: string;
  body: string | null;
  lessonId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AppSettings {
  notetakerEnabledGlobally: boolean;
  notetakerDisplayName: string;
  requireGuardianConsentUnder18: boolean;
  transcriptRetentionDays: number;
  mediaRetentionHours: number;
  /** Pooled tutoring hours at which the question banks are included. */
  questionBankFreeHours: number;
  /** Whether a paid order with no matching account invites one. */
  autoInvitePaidBuyers: boolean;
}

/** Who is signed in, resolved once per request. */
export interface PortalSession {
  profile: Profile;
  studentId: string | null;
  tutorId: string | null;
  parentId: string | null;
  isDemo: boolean;
}

/** A subject as a student sees it on their dashboard. */
export interface SubjectSummary {
  subject: Subject;
  tutors: Tutor[];
  lessonCount: number;
  lastLesson: LessonWithContext | null;
  nextLesson: LessonWithContext | null;
  openHomeworkCount: number;
}

/** What a tutor is shown before they walk into a lesson. Assembled from stored
 *  notes, not from a fresh model call — see lib/briefing.ts. */
export interface PreLessonBriefing {
  lesson: LessonWithContext;
  lastLesson: LessonWithContext | null;
  lastTopics: string[];
  needsReinforcement: string[];
  openHomework: string[];
  suggestedCheck: string | null;
  suggestedNextTopics: string[];
}

/* ==========================================================================
   IA review
   --------------------------------------------------------------------------
   An internal assessment, uploaded by a student and read against the published
   criteria. The domain shapes; the marking itself is in lib/ia/.

   `IaReviewRecord` deliberately keeps the review body opaque here. Its shape
   is a versioned contract in lib/ia/schema.ts, and a second declaration of it
   in this file would be a second thing to keep in step with the model's output
   — with nothing to notice when they drift apart.
   ========================================================================== */

export const IA_SUBMISSION_STATUSES = ["uploaded", "reviewing", "reviewed", "failed"] as const;
export type IaSubmissionStatus = (typeof IA_SUBMISSION_STATUSES)[number];

export interface IaSubmission {
  id: string;
  studentId: string;
  subject: "biology" | "chemistry" | "maths_aa";
  level: "SL" | "HL";
  /** "May 2027" — what selects the marking model. */
  session: string;
  stage: "partial_draft" | "complete_draft" | "final";
  fileName: string;
  fileSize: number;
  fileHash: string;
  wordCount: number | null;
  studentNote: string | null;
  status: IaSubmissionStatus;
  failureNote: string | null;
  /** Set when the student asked for a person to read it. */
  professionalReviewRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IaReviewRecord {
  id: string;
  submissionId: string;
  rubricId: string;
  packVersion: string | null;
  mode: "marking" | "feedback_only";
  calibrationStatus: "uncalibrated";
  total: number | null;
  maxTotal: number;
  body: IaReview;
  createdAt: string;
}

/** A submission with whatever reviews it has, newest first. */
export interface IaSubmissionWithReviews {
  submission: IaSubmission;
  reviews: IaReviewRecord[];
}

/**
 * What a student may spend, and why they have it.
 *
 * The balance is derived from the ledger rather than stored, so `entries` and
 * `balance` cannot disagree — and the entries are what answer "where did my
 * second credit go?" without anyone having to look in the database.
 */
export interface IaCreditLedger {
  balance: number;
  entries: IaCreditEntry[];
}

export interface IaCreditEntry {
  id: string;
  delta: number;
  reason: "purchase" | "admin_grant" | "review" | "refund" | "correction";
  note: string | null;
  createdAt: string;
}
