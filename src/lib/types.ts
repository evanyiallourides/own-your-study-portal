/* ==========================================================================
   Portal domain types
   --------------------------------------------------------------------------
   Deliberately not the database row shapes. The dashboards work in terms of
   people and lessons; mapping snake_case rows onto these happens once, in the
   Supabase repository, so a schema change touches one file rather than fifty
   components.
   ========================================================================== */

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
