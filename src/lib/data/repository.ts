/* ==========================================================================
   Repository contract
   --------------------------------------------------------------------------
   Every screen reads through this interface, so the pages know nothing about
   Postgres, RLS or the demo dataset. Two implementations satisfy it:

     · SupabaseRepository — the real one. Authorisation is the database's job;
       this only shapes rows into domain objects.
     · DemoRepository     — an in-memory dataset for running with no backend.
       It re-implements the access rules in TypeScript so that role separation
       is genuinely testable in demo mode rather than merely assumed.

   A repository is always constructed with a session and is scoped to it.
   ========================================================================== */

import type {
  Order,
  OrderPayment,
  OrderStatus,
  Parent,
  AppSettings,
  Assignment,
  HomeworkItem,
  Lesson,
  LessonFile,
  LessonNotes,
  LessonNotesForTutor,
  LessonStatus,
  LessonWithContext,
  MeetingPlatform,
  Notification,
  PortalSession,
  Profile,
  Student,
  Subject,
  SubjectSummary,
  TopicProgress,
  Transcript,
  Tutor,
  QuestionBankAccess,
  IaCreditLedger,
  IaSubmission,
  IaSubmissionWithReviews,
  WiseUnmatchedTransfer,
} from "@/lib/types";

export interface LessonFilter {
  studentId?: string;
  tutorId?: string;
  subjectId?: string;
  status?: LessonStatus | LessonStatus[];
  /** Inclusive lower bound on scheduled_at, ISO string. */
  from?: string;
  /** Exclusive upper bound on scheduled_at, ISO string. */
  to?: string;
  /** Case-insensitive match against the lesson title and subject name. */
  search?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export interface LessonNotesPatch {
  summary?: string | null;
  topicsCovered?: string[];
  keyConcepts?: string[];
  strengths?: string[];
  areasForImprovement?: string[];
  misconceptions?: string[];
  homework?: string[];
  resourcesMentioned?: string[];
  nextSteps?: string[];
  tutorPrivateNotes?: string | null;
}

export interface CreateLessonInput {
  studentId: string;
  tutorId: string;
  subjectId: string;
  title: string | null;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  meetingPlatform: MeetingPlatform;
  notetakerEnabled: boolean;
}

export interface UpdateLessonInput {
  title?: string | null;
  scheduledAt?: string;
  durationMinutes?: number;
  meetingUrl?: string | null;
  meetingPlatform?: MeetingPlatform;
  status?: LessonStatus;
  notetakerEnabled?: boolean;
}

/** Recording a meeting the portal created, as opposed to one pasted in. Kept
 *  apart from UpdateLessonInput so the Google integration is the only thing
 *  that writes these fields — an ordinary lesson edit cannot reach them, and
 *  cannot accidentally claim the portal manages a link it did not make. */
export interface LessonMeetingInput {
  meetingUrl: string | null;
  meetingPlatform: MeetingPlatform;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleOwnerId: string | null;
  managed: boolean;
}

export interface SubjectInput {
  name: string;
  curriculum: string;
  level: string | null;
  division: string | null;
}

export interface UploadFileInput {
  lessonId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: LessonFile["category"];
  body: ArrayBuffer;
}

export interface CreateIaSubmissionInput {
  studentId: string;
  subject: IaSubmission["subject"];
  level: IaSubmission["level"];
  session: string;
  stage: IaSubmission["stage"];
  storagePath: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  wordCount: number | null;
  studentNote: string | null;
}

/** Thrown when the caller is not allowed to do something. Surfaced to the user
 *  as a 403-shaped page, never as a raw database message. */
export class AccessDeniedError extends Error {
  constructor(message = "You do not have access to this.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface Repository {
  readonly session: PortalSession;

  /* -- catalogue -- */
  listSubjects(includeArchived?: boolean): Promise<Subject[]>;
  getSubject(subjectId: string): Promise<Subject | null>;
  createSubject(input: SubjectInput): Promise<Subject>;
  updateSubject(subjectId: string, input: Partial<SubjectInput> & { archived?: boolean }): Promise<Subject>;

  /* -- people -- */
  listStudents(search?: string): Promise<Student[]>;
  getStudent(studentId: string): Promise<Student | null>;
  listTutors(search?: string): Promise<Tutor[]>;
  getTutor(tutorId: string): Promise<Tutor | null>;
  listProfiles(role?: Profile["role"]): Promise<Profile[]>;
  setProfileActive(profileId: string, active: boolean): Promise<void>;

  /* -- assignments -- */
  listAssignments(filter?: { tutorId?: string; studentId?: string }): Promise<Assignment[]>;
  createAssignment(input: { tutorId: string; studentId: string; subjectId: string }): Promise<void>;
  setAssignmentActive(assignmentId: string, active: boolean): Promise<void>;
  listStudentSubjects(studentId: string): Promise<Subject[]>;
  addStudentSubject(studentId: string, subjectId: string): Promise<void>;

  /* -- families --
     A purchase can create a parent account and link it to the child it was
     bought for, so there has to be somewhere to see that link and undo it. */
  listParents(search?: string): Promise<Parent[]>;
  listParentsForStudent(studentId: string): Promise<Parent[]>;
  linkParentToStudent(parentId: string, studentId: string, relationship: string | null): Promise<void>;
  unlinkParentFromStudent(parentId: string, studentId: string): Promise<void>;

  /* -- question banks -- */
  getQuestionBankAccess(studentId: string): Promise<QuestionBankAccess>;
  setQuestionBankAccess(
    studentId: string,
    input: { granted: boolean; expiresAt: string | null; note: string | null },
  ): Promise<void>;

  /* -- IA review --
     `spendIaCredit` is separate from `saveIaReview` rather than folded into
     it, because the order matters and is the whole of the guarantee that a
     failed review is free: the review is stored first, the credit is taken
     second, and a crash between the two leaves a student holding a review they
     were not charged for. That is the right way round for it to fail. */
  getIaCredits(studentId: string): Promise<IaCreditLedger>;
  grantIaCredits(studentId: string, count: number, note: string): Promise<void>;
  spendIaCredit(studentId: string, note: string): Promise<number>;

  listIaSubmissions(filter?: { studentId?: string; escalatedOnly?: boolean }): Promise<IaSubmissionWithReviews[]>;
  getIaSubmission(submissionId: string): Promise<IaSubmissionWithReviews | null>;
  createIaSubmission(input: CreateIaSubmissionInput): Promise<IaSubmission>;
  setIaSubmissionStatus(
    submissionId: string,
    status: IaSubmission["status"],
    failureNote?: string | null,
  ): Promise<void>;
  /** Store a finished review. Returns its id so the credit can be tied to it. */
  saveIaReview(submissionId: string, review: unknown): Promise<string>;
  requestProfessionalReview(submissionId: string): Promise<void>;

  /* -- orders -- */
  listOrders(filter?: { status?: OrderStatus[]; unmatchedOnly?: boolean }): Promise<Order[]>;
  listOrdersForStudent(studentId: string): Promise<Order[]>;
  getOrderPayments(orderId: string): Promise<OrderPayment[]>;
  /** Attach a paid order to a student and apply whatever it granted. */
  linkOrderToStudent(orderId: string, studentId: string): Promise<void>;
  /** Detach it again, for a link made to the wrong person. */
  unlinkOrder(orderId: string): Promise<void>;

  /** Wise transfers waiting for a person to say which order they paid for. */
  listUnmatchedWiseTransfers(): Promise<WiseUnmatchedTransfer[]>;
  /** Attach one to an order and settle it, exactly as the webhook would have. */
  attachWiseTransferToOrder(transferId: string, orderId: string): Promise<void>;

  /* -- lessons -- */
  listLessons(filter: LessonFilter): Promise<LessonWithContext[]>;
  getLesson(lessonId: string): Promise<LessonWithContext | null>;
  createLesson(input: CreateLessonInput): Promise<Lesson>;
  updateLesson(lessonId: string, input: UpdateLessonInput): Promise<void>;
  /** Attach (or detach) a portal-created meeting. */
  setLessonMeeting(lessonId: string, input: LessonMeetingInput): Promise<void>;

  /* -- lesson content -- */
  getLessonNotes(lessonId: string): Promise<LessonNotes | null>;
  getLessonNotesForTutor(lessonId: string): Promise<LessonNotesForTutor | null>;
  saveLessonNotes(lessonId: string, patch: LessonNotesPatch): Promise<void>;
  publishLesson(lessonId: string): Promise<void>;
  unpublishLesson(lessonId: string): Promise<void>;
  getTranscript(lessonId: string): Promise<Transcript | null>;

  /* -- files -- */
  listLessonFiles(lessonId: string): Promise<LessonFile[]>;
  uploadLessonFile(input: UploadFileInput): Promise<LessonFile>;
  deleteLessonFile(fileId: string): Promise<void>;

  /* -- homework & progress -- */
  listHomework(filter: { studentId?: string; completed?: boolean }): Promise<HomeworkItem[]>;
  setHomeworkCompleted(homeworkId: string, completed: boolean): Promise<void>;
  listProgress(studentId: string, subjectId?: string): Promise<TopicProgress[]>;

  /* -- dashboards -- */
  getSubjectSummaries(studentId: string): Promise<SubjectSummary[]>;

  /* -- misc -- */
  listNotifications(limit?: number): Promise<Notification[]>;
  markNotificationRead(notificationId: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  adminCounts(): Promise<Record<string, number>>;
}
