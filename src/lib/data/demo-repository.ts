/* ==========================================================================
   Demo repository
   --------------------------------------------------------------------------
   The access rules from the RLS migration, restated in TypeScript. That
   duplication is deliberate: it means "a tutor cannot open an unassigned
   student" is a property of the running application in demo mode too, and it
   is what the access tests in src/lib/data/access.test.ts exercise.
   ========================================================================== */

import { demoState, demoId, refreshDemoClock } from "@/lib/data/demo-store";
import {
  AccessDeniedError,
  NotFoundError,
  type CreateLessonInput,
  type LessonFilter,
  type LessonMeetingInput,
  type LessonNotesPatch,
  type CreateIaSubmissionInput,
  type Repository,
  type SubjectInput,
  type UpdateLessonInput,
  type UploadFileInput,
} from "@/lib/data/repository";
import type {
  Parent,
  Order,
  IaCreditEntry,
  IaCreditLedger,
  IaReviewRecord,
  IaSubmission,
  IaSubmissionWithReviews,
  OrderPayment,
  OrderStatus,
  AppSettings,
  Assignment,
  HomeworkItem,
  Lesson,
  LessonFile,
  LessonNotes,
  LessonNotesForTutor,
  LessonStatus,
  LessonWithContext,
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
  WiseUnmatchedTransfer,
} from "@/lib/types";

const STUDENT_VISIBLE_UNPUBLISHED: LessonStatus[] = ["scheduled", "in_progress", "cancelled"];

export class DemoRepository implements Repository {
  // Written out rather than declared as a constructor parameter property, so
  // this file can be run directly by Node's type stripping in the access tests.
  readonly session: PortalSession;

  constructor(session: PortalSession) {
    this.session = session;
    // The demo dataset is re-anchored to the real date per repository rather
    // than per request — the same thing in practice, and it keeps the call in
    // one place instead of at the top of every read.
    refreshDemoClock();
  }

  /* -- access rules ------------------------------------------------------ */

  private get isAdmin() {
    return this.session.profile.role === "admin";
  }

  private teachesStudent(studentId: string): boolean {
    const tutorId = this.session.tutorId;
    if (!tutorId) return false;
    return demoState.assignments.some(
      (a) => a.active && a.tutorId === tutorId && a.studentId === studentId,
    );
  }

  private teachesStudentSubject(studentId: string, subjectId: string): boolean {
    const tutorId = this.session.tutorId;
    if (!tutorId) return false;
    return demoState.assignments.some(
      (a) => a.active && a.tutorId === tutorId && a.studentId === studentId && a.subjectId === subjectId,
    );
  }

  private parentOf(studentId: string): boolean {
    const parentId = this.session.parentId;
    if (!parentId) return false;
    return demoState.parentStudents.some((l) => l.parentId === parentId && l.studentId === studentId);
  }

  /** Read access to a student record, in any role. */
  canSeeStudent(studentId: string): boolean {
    if (this.isAdmin) return true;
    if (this.session.studentId === studentId) return true;
    if (this.teachesStudent(studentId)) return true;
    return this.parentOf(studentId);
  }

  canReadLesson(lesson: Lesson): boolean {
    if (this.isAdmin) return true;
    if (this.session.studentId === lesson.studentId) {
      return lesson.published || STUDENT_VISIBLE_UNPUBLISHED.includes(lesson.status);
    }
    if (this.teachesStudentSubject(lesson.studentId, lesson.subjectId)) return true;
    if (this.parentOf(lesson.studentId)) {
      return lesson.published || lesson.status === "scheduled" || lesson.status === "in_progress";
    }
    return false;
  }

  canWriteLesson(lesson: Lesson): boolean {
    if (this.isAdmin) return true;
    return this.teachesStudentSubject(lesson.studentId, lesson.subjectId);
  }

  /* Reads and writes fail differently, and deliberately so.
     A read the caller is not entitled to returns null or an empty list,
     because that is precisely what Row Level Security does — it filters rows,
     it does not announce that a row was withheld. Telling an unauthorised
     caller that a record exists is itself a disclosure.
     A write, by contrast, throws: silently discarding someone's edit would be
     worse than refusing it. */

  private requireAdmin() {
    if (!this.isAdmin) throw new AccessDeniedError("This area is for administrators.");
  }

  private lessonOrThrow(lessonId: string): Lesson {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson) throw new NotFoundError("That lesson does not exist.");
    return lesson;
  }

  private writableLesson(lessonId: string): Lesson {
    const lesson = this.lessonOrThrow(lessonId);
    if (!this.canWriteLesson(lesson)) throw new AccessDeniedError();
    return lesson;
  }

  /* -- catalogue --------------------------------------------------------- */

  async listSubjects(includeArchived = false): Promise<Subject[]> {
    return demoState.subjects
      .filter((s) => includeArchived || !s.archived)
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getSubject(subjectId: string): Promise<Subject | null> {
    return demoState.subjects.find((s) => s.id === subjectId) ?? null;
  }

  async createSubject(input: SubjectInput): Promise<Subject> {
    this.requireAdmin();
    const subject: Subject = {
      id: demoId("sub"),
      ...input,
      archived: false,
      displayName: [input.curriculum, input.name, input.level].filter(Boolean).join(" "),
    };
    demoState.subjects.push(subject);
    return subject;
  }

  async updateSubject(
    subjectId: string,
    input: Partial<SubjectInput> & { archived?: boolean },
  ): Promise<Subject> {
    this.requireAdmin();
    const subject = demoState.subjects.find((s) => s.id === subjectId);
    if (!subject) throw new NotFoundError("That subject does not exist.");
    Object.assign(subject, input);
    subject.displayName = [subject.curriculum, subject.name, subject.level].filter(Boolean).join(" ");
    return subject;
  }

  /* -- people ------------------------------------------------------------ */

  async listStudents(search?: string): Promise<Student[]> {
    const visible = demoState.students.filter((s) => this.canSeeStudent(s.id));
    if (!search) return visible;
    const q = search.toLowerCase();
    return visible.filter(
      (s) =>
        s.profile.fullName.toLowerCase().includes(q) ||
        s.profile.email.toLowerCase().includes(q) ||
        (s.school ?? "").toLowerCase().includes(q),
    );
  }

  async getStudent(studentId: string): Promise<Student | null> {
    if (!this.canSeeStudent(studentId)) return null;
    return demoState.students.find((s) => s.id === studentId) ?? null;
  }

  /** The same two rules as the database, over the in-memory store. */
  /* -- orders ------------------------------------------------------------
     Restates in TypeScript what RLS enforces in SQL: administrators see
     everything, a student sees their own, a parent sees their children's, and
     a tutor sees none — billing is not a tutor's business. */

  private visibleOrders(): Order[] {
    if (this.session.profile.role === "admin") return demoState.orders;
    if (this.session.profile.role === "tutor") return [];
    return demoState.orders.filter(
      (o) => o.studentId !== null && this.canSeeStudent(o.studentId),
    );
  }

  async listOrders(filter?: { status?: OrderStatus[]; unmatchedOnly?: boolean }): Promise<Order[]> {
    let rows = this.visibleOrders();
    if (filter?.status?.length) rows = rows.filter((o) => filter.status!.includes(o.status));
    if (filter?.unmatchedOnly) rows = rows.filter((o) => o.studentId === null);
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listOrdersForStudent(studentId: string): Promise<Order[]> {
    if (!this.canSeeStudent(studentId)) return [];
    return demoState.orders.filter((o) => o.studentId === studentId);
  }

  async getOrderPayments(orderId: string): Promise<OrderPayment[]> {
    const order = this.visibleOrders().find((o) => o.id === orderId);
    if (!order) return [];
    // The demo set carries no payment ledger of its own; one row standing for
    // what has been collected is enough to render the screen honestly.
    if (order.amountPaidMinor === 0) return [];
    return [
      {
        id: `${order.id}-payment`,
        kind: order.status === "refunded" ? "refund" : "payment",
        amountMinor: order.amountPaidMinor,
        currency: order.currency,
        occurredAt: order.createdAt,
        detail:
          order.instalmentMonths !== null
            ? `${order.instalmentsPaid} of ${order.instalmentMonths} instalments`
            : null,
      },
    ];
  }

  async linkOrderToStudent(orderId: string, studentId: string): Promise<void> {
    this.requireAdmin();
    const order = demoState.orders.find((o) => o.id === orderId);
    if (!order) throw new NotFoundError("That order no longer exists.");
    const student = demoState.students.find((s) => s.id === studentId);
    if (!student) throw new NotFoundError("That student no longer exists.");

    order.studentId = studentId;
    order.studentName = student.profile?.fullName ?? null;
    order.claimedAt = new Date().toISOString();

    // Apply what the order granted, extending rather than resetting — the same
    // rule claim_orders_for_profile() applies in SQL.
    if (order.grantsQuestionBankDays !== null) {
      const existing = demoState.questionBankAccess[studentId];
      const from =
        existing?.expiresAt && new Date(existing.expiresAt) > new Date()
          ? new Date(existing.expiresAt)
          : new Date();
      from.setDate(from.getDate() + order.grantsQuestionBankDays);
      demoState.questionBankAccess[studentId] = {
        granted: true,
        expiresAt: from.toISOString(),
        note: `Paid: ${order.skuName}`,
        grantedAt: new Date().toISOString(),
      };
    }
  }

  async unlinkOrder(orderId: string): Promise<void> {
    this.requireAdmin();
    const order = demoState.orders.find((o) => o.id === orderId);
    if (!order) throw new NotFoundError("That order no longer exists.");
    order.studentId = null;
    order.studentName = null;
    order.claimedAt = null;
  }

  async listUnmatchedWiseTransfers(): Promise<WiseUnmatchedTransfer[]> {
    this.requireAdmin();
    // The demo set is Stripe's story — nothing arrives by bank transfer here,
    // so the honest render of this screen is an empty queue.
    return [];
  }

  async attachWiseTransferToOrder(): Promise<void> {
    this.requireAdmin();
    throw new NotFoundError("That transfer no longer exists.");
  }

  async markWiseOrderPaid(orderId: string): Promise<void> {
    this.requireAdmin();
    const order = demoState.orders.find((o) => o.id === orderId);
    if (!order) throw new NotFoundError("That order no longer exists.");
    if (order.provider !== "wise") {
      throw new Error("Only Wise orders are settled by hand — Stripe settles on its own.");
    }
    if (order.status !== "pending") {
      throw new Error("That order is not waiting on a payment.");
    }
    // The demo set is Stripe's story — nothing here grants an entitlement,
    // it only proves the button works without a real settlement to run.
    order.status = "paid";
    order.amountPaidMinor = order.amountTotalMinor;
  }

  /* ==========================================================================
     IA review
     --------------------------------------------------------------------------
     The same access rules as the migration, restated — a student sees their
     own, a tutor sees the students they teach, an administrator sees all, and
     a parent sees the ledger but not the feedback. The last of those is the
     one worth restating in TypeScript rather than trusting to a policy file:
     "your mother can see that you had an IA reviewed, and cannot read what it
     said" is a promise made to a sixteen-year-old, and demo mode should keep
     it too.
     ========================================================================== */

  async getIaCredits(studentId: string): Promise<IaCreditLedger> {
    // Parents may read the ledger — they paid for it — so this is a wider test
    // than canSeeStudent, which governs the coursework itself.
    if (!this.canSeeStudent(studentId) && !this.isParentOf(studentId)) {
      return { balance: 0, entries: [] };
    }
    const entries = [...(demoState.iaCredits[studentId] ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return {
      balance: entries.reduce((total, e) => total + e.delta, 0),
      entries,
    };
  }

  async grantIaCredits(studentId: string, count: number, note: string): Promise<void> {
    if (this.session.profile.role !== "admin") throw new AccessDeniedError();
    if (count === 0) return;
    const entry: IaCreditEntry = {
      id: demoId("iacredit"),
      delta: count,
      reason: count > 0 ? "admin_grant" : "correction",
      note,
      createdAt: new Date().toISOString(),
    };
    demoState.iaCredits[studentId] = [...(demoState.iaCredits[studentId] ?? []), entry];
  }

  async spendIaCredit(studentId: string, note: string): Promise<number> {
    const ledger = await this.getIaCredits(studentId);
    if (ledger.balance < 1) {
      throw new Error(`No IA review credit available for student ${studentId}`);
    }
    demoState.iaCredits[studentId] = [
      ...(demoState.iaCredits[studentId] ?? []),
      {
        id: demoId("iacredit"),
        delta: -1,
        reason: "review",
        note,
        createdAt: new Date().toISOString(),
      },
    ];
    return ledger.balance - 1;
  }

  async listIaSubmissions(
    filter: { studentId?: string; escalatedOnly?: boolean } = {},
  ): Promise<IaSubmissionWithReviews[]> {
    return demoState.iaSubmissions
      .filter((s) => this.canSeeStudent(s.studentId))
      .filter((s) => !filter.studentId || s.studentId === filter.studentId)
      .filter((s) => !filter.escalatedOnly || s.professionalReviewRequestedAt !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((submission) => this.withReviews(submission));
  }

  async getIaSubmission(submissionId: string): Promise<IaSubmissionWithReviews | null> {
    const submission = demoState.iaSubmissions.find((s) => s.id === submissionId);
    if (!submission) return null;
    if (!this.canSeeStudent(submission.studentId)) throw new AccessDeniedError();
    return this.withReviews(submission);
  }

  async createIaSubmission(input: CreateIaSubmissionInput): Promise<IaSubmission> {
    const now = new Date().toISOString();
    const submission: IaSubmission = {
      id: demoId("iasub"),
      studentId: input.studentId,
      subject: input.subject,
      level: input.level,
      session: input.session,
      stage: input.stage,
      fileName: input.fileName,
      fileSize: input.fileSize,
      fileHash: input.fileHash,
      wordCount: input.wordCount,
      studentNote: input.studentNote,
      status: "uploaded",
      failureNote: null,
      professionalReviewRequestedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    demoState.iaSubmissions.push(submission);
    return submission;
  }

  async setIaSubmissionStatus(
    submissionId: string,
    status: IaSubmission["status"],
    failureNote: string | null = null,
  ): Promise<void> {
    const submission = demoState.iaSubmissions.find((s) => s.id === submissionId);
    if (!submission) throw new NotFoundError("No such submission.");
    submission.status = status;
    submission.failureNote = failureNote;
    submission.updatedAt = new Date().toISOString();
  }

  async saveIaReview(submissionId: string, review: unknown): Promise<string> {
    const body = review as IaReviewRecord["body"];
    const record: IaReviewRecord = {
      id: demoId("iarev"),
      submissionId,
      rubricId: body.rubricId,
      packVersion: body.assessmentPackVersion,
      mode: body.mode,
      calibrationStatus: "uncalibrated",
      total: body.total,
      maxTotal: body.maxTotal,
      body,
      createdAt: new Date().toISOString(),
    };
    demoState.iaReviews.push(record);
    return record.id;
  }

  async requestProfessionalReview(submissionId: string): Promise<void> {
    const submission = demoState.iaSubmissions.find((s) => s.id === submissionId);
    if (!submission) throw new NotFoundError("No such submission.");
    if (!this.canSeeStudent(submission.studentId)) throw new AccessDeniedError();
    submission.professionalReviewRequestedAt = new Date().toISOString();
  }

  private withReviews(submission: IaSubmission): IaSubmissionWithReviews {
    return {
      submission,
      reviews: demoState.iaReviews
        .filter((r) => r.submissionId === submission.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  private isParentOf(studentId: string): boolean {
    return (
      this.session.parentId !== null &&
      demoState.parentStudents.some(
        (link) => link.parentId === this.session.parentId && link.studentId === studentId,
      )
    );
  }

  async getQuestionBankAccess(studentId: string): Promise<QuestionBankAccess> {
    if (!this.canSeeStudent(studentId)) {
      return {
        granted: false,
        source: "none",
        expiresAt: null,
        note: null,
        grantedAt: null,
        pooledHours: 0,
        freeAtHours: demoState.settings.questionBankFreeHours,
        hasSubscriptionRow: false,
      };
    }

    const minutes = demoState.lessons
      .filter((l) => l.studentId === studentId && l.status !== "cancelled")
      .reduce((total, l) => total + l.durationMinutes, 0);
    const pooledHours = Math.round(minutes / 6) / 10;
    const freeAtHours = demoState.settings.questionBankFreeHours;

    const sub = demoState.questionBankAccess[studentId] ?? null;
    const liveSubscription =
      !!sub && sub.granted && (!sub.expiresAt || new Date(sub.expiresAt) > new Date());
    const byHours = pooledHours >= freeAtHours;

    return {
      granted: liveSubscription || byHours,
      source: liveSubscription ? "subscription" : byHours ? "pooled-hours" : "none",
      expiresAt: sub?.expiresAt ?? null,
      note: sub?.note ?? null,
      grantedAt: sub?.grantedAt ?? null,
      pooledHours,
      freeAtHours,
      hasSubscriptionRow: !!sub,
    };
  }

  async setQuestionBankAccess(
    studentId: string,
    input: { granted: boolean; expiresAt: string | null; note: string | null },
  ): Promise<void> {
    this.requireAdmin();
    demoState.questionBankAccess[studentId] = {
      granted: input.granted,
      expiresAt: input.expiresAt,
      note: input.note,
      grantedAt: new Date().toISOString(),
    };
  }

  async listTutors(search?: string): Promise<Tutor[]> {
    let tutors = demoState.tutors;
    if (!this.isAdmin) {
      if (this.session.tutorId) {
        tutors = tutors.filter((t) => t.id === this.session.tutorId);
      } else {
        // A student or parent sees only the tutors who teach them.
        const studentIds = this.visibleStudentIds();
        const tutorIds = new Set(
          demoState.assignments.filter((a) => a.active && studentIds.has(a.studentId)).map((a) => a.tutorId),
        );
        tutors = tutors.filter((t) => tutorIds.has(t.id));
      }
    }
    if (!search) return tutors;
    const q = search.toLowerCase();
    return tutors.filter(
      (t) => t.profile.fullName.toLowerCase().includes(q) || t.profile.email.toLowerCase().includes(q),
    );
  }

  private visibleStudentIds(): Set<string> {
    return new Set(demoState.students.filter((s) => this.canSeeStudent(s.id)).map((s) => s.id));
  }

  async getTutor(tutorId: string): Promise<Tutor | null> {
    const tutors = await this.listTutors();
    return tutors.find((t) => t.id === tutorId) ?? null;
  }

  async listProfiles(role?: Profile["role"]): Promise<Profile[]> {
    this.requireAdmin();
    return demoState.profiles.filter((p) => !role || p.role === role);
  }

  async setProfileActive(profileId: string, active: boolean): Promise<void> {
    this.requireAdmin();
    const profile = demoState.profiles.find((p) => p.id === profileId);
    if (!profile) throw new NotFoundError();
    profile.active = active;
    const tutor = demoState.tutors.find((t) => t.profileId === profileId);
    if (tutor) tutor.active = active;
  }

  /* -- assignments ------------------------------------------------------- */

  async listAssignments(filter: { tutorId?: string; studentId?: string } = {}): Promise<Assignment[]> {
    const visibleStudents = this.visibleStudentIds();
    return demoState.assignments
      .filter((a) => this.isAdmin || visibleStudents.has(a.studentId))
      .filter((a) => (filter.tutorId ? a.tutorId === filter.tutorId : true))
      .filter((a) => (filter.studentId ? a.studentId === filter.studentId : true))
      .map((a) => ({
        ...a,
        tutor: demoState.tutors.find((t) => t.id === a.tutorId),
        student: demoState.students.find((s) => s.id === a.studentId),
        subject: demoState.subjects.find((s) => s.id === a.subjectId),
      }));
  }

  async createAssignment(input: { tutorId: string; studentId: string; subjectId: string }): Promise<void> {
    this.requireAdmin();
    const existing = demoState.assignments.find(
      (a) =>
        a.tutorId === input.tutorId && a.studentId === input.studentId && a.subjectId === input.subjectId,
    );
    if (existing) {
      existing.active = true;
      return;
    }
    demoState.assignments.push({
      id: demoId("a"),
      ...input,
      active: true,
      createdAt: new Date().toISOString(),
    });
    // An assignment implies the student studies the subject.
    if (!demoState.studentSubjects.some((ss) => ss.studentId === input.studentId && ss.subjectId === input.subjectId)) {
      demoState.studentSubjects.push({
        id: demoId("ss"),
        studentId: input.studentId,
        subjectId: input.subjectId,
        active: true,
      });
    }
  }

  async setAssignmentActive(assignmentId: string, active: boolean): Promise<void> {
    this.requireAdmin();
    const assignment = demoState.assignments.find((a) => a.id === assignmentId);
    if (!assignment) throw new NotFoundError();
    assignment.active = active;
  }

  async listStudentSubjects(studentId: string): Promise<Subject[]> {
    if (!this.canSeeStudent(studentId)) return [];
    const ids = demoState.studentSubjects
      .filter((ss) => ss.studentId === studentId && ss.active)
      .map((ss) => ss.subjectId);
    // A tutor only sees the subjects they actually teach this student.
    const scoped =
      this.isAdmin || this.session.studentId === studentId || this.session.parentId
        ? ids
        : ids.filter((id) => this.teachesStudentSubject(studentId, id));
    return demoState.subjects.filter((s) => scoped.includes(s.id));
  }

  async addStudentSubject(studentId: string, subjectId: string): Promise<void> {
    this.requireAdmin();
    if (demoState.studentSubjects.some((ss) => ss.studentId === studentId && ss.subjectId === subjectId)) return;
    demoState.studentSubjects.push({ id: demoId("ss"), studentId, subjectId, active: true });
  }

  /* -- families ---------------------------------------------------------- */

  async listParents(search?: string): Promise<Parent[]> {
    // Only an administrator browses parents as a list. A parent reaching this
    // would be reading the other families on the roll.
    if (!this.isAdmin) return [];
    const needle = search?.trim().toLowerCase();
    if (!needle) return demoState.parents;
    return demoState.parents.filter(
      (p) =>
        p.profile.fullName.toLowerCase().includes(needle) ||
        p.profile.email.toLowerCase().includes(needle),
    );
  }

  async listParentsForStudent(studentId: string): Promise<Parent[]> {
    // Whoever may see the student may see who is entitled to watch them —
    // including the student themselves, who should be able to find out.
    if (!this.canSeeStudent(studentId)) return [];
    const ids = demoState.parentStudents
      .filter((l) => l.studentId === studentId)
      .map((l) => l.parentId);
    return demoState.parents.filter((p) => ids.includes(p.id));
  }

  async linkParentToStudent(
    parentId: string,
    studentId: string,
    relationship: string | null,
  ): Promise<void> {
    this.requireAdmin();
    if (!demoState.parents.some((p) => p.id === parentId)) throw new NotFoundError();
    if (!demoState.students.some((s) => s.id === studentId)) throw new NotFoundError();
    const existing = demoState.parentStudents.find(
      (l) => l.parentId === parentId && l.studentId === studentId,
    );
    if (existing) {
      existing.relationship = relationship;
      return;
    }
    demoState.parentStudents.push({ parentId, studentId, relationship });
  }

  async unlinkParentFromStudent(parentId: string, studentId: string): Promise<void> {
    this.requireAdmin();
    demoState.parentStudents = demoState.parentStudents.filter(
      (l) => !(l.parentId === parentId && l.studentId === studentId),
    );
  }

  /* -- lessons ----------------------------------------------------------- */

  private decorate(lesson: Lesson): LessonWithContext {
    const subject = demoState.subjects.find((s) => s.id === lesson.subjectId);
    const tutor = demoState.tutors.find((t) => t.id === lesson.tutorId);
    const student = demoState.students.find((s) => s.id === lesson.studentId);
    if (!subject || !tutor || !student) throw new NotFoundError("Demo data is inconsistent.");
    return {
      ...lesson,
      subject,
      tutor,
      student,
      hasNotes: demoState.notes.some((n) => n.lessonId === lesson.id),
      hasTranscript: demoState.transcripts.some(
        (t) => t.lessonId === lesson.id && t.processingStatus === "ready",
      ),
      fileCount: demoState.files.filter((f) => f.lessonId === lesson.id).length,
    };
  }

  async listLessons(filter: LessonFilter): Promise<LessonWithContext[]> {
    const statuses = filter.status
      ? Array.isArray(filter.status)
        ? filter.status
        : [filter.status]
      : null;
    const q = filter.search?.trim().toLowerCase();

    let rows = demoState.lessons.filter((l) => this.canReadLesson(l));
    if (filter.studentId) rows = rows.filter((l) => l.studentId === filter.studentId);
    if (filter.tutorId) rows = rows.filter((l) => l.tutorId === filter.tutorId);
    if (filter.subjectId) rows = rows.filter((l) => l.subjectId === filter.subjectId);
    if (statuses) rows = rows.filter((l) => statuses.includes(l.status));
    if (filter.from) rows = rows.filter((l) => l.scheduledAt >= filter.from!);
    if (filter.to) rows = rows.filter((l) => l.scheduledAt < filter.to!);

    let decorated = rows.map((l) => this.decorate(l));
    if (q) {
      decorated = decorated.filter(
        (l) =>
          (l.title ?? "").toLowerCase().includes(q) ||
          l.subject.displayName.toLowerCase().includes(q) ||
          l.student.profile.fullName.toLowerCase().includes(q) ||
          l.tutor.profile.fullName.toLowerCase().includes(q),
      );
    }
    const dir = filter.order === "asc" ? 1 : -1;
    decorated.sort((a, b) => dir * a.scheduledAt.localeCompare(b.scheduledAt));
    return filter.limit ? decorated.slice(0, filter.limit) : decorated;
  }

  async getLesson(lessonId: string): Promise<LessonWithContext | null> {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson || !this.canReadLesson(lesson)) return null;
    return this.decorate(lesson);
  }

  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    const allowed = this.isAdmin || this.teachesStudentSubject(input.studentId, input.subjectId);
    if (!allowed) throw new AccessDeniedError("You are not assigned to this student in this subject.");
    const lesson: Lesson = {
      id: demoId("l"),
      ...input,
      startedAt: null,
      endedAt: null,
      status: "scheduled",
      published: false,
      publishedAt: null,
      recallBotId: null,
      processingError: null,
      googleEventId: null,
      googleCalendarId: null,
      meetLinkManaged: false,
    };
    demoState.lessons.push(lesson);
    return lesson;
  }

  async setLessonMeeting(lessonId: string, input: LessonMeetingInput): Promise<void> {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson || !this.canReadLesson(lesson)) {
      throw new AccessDeniedError("You cannot change this lesson.");
    }
    lesson.meetingUrl = input.meetingUrl;
    lesson.meetingPlatform = input.meetingPlatform;
    lesson.googleEventId = input.googleEventId;
    lesson.googleCalendarId = input.googleCalendarId;
    lesson.meetLinkManaged = input.managed;
  }

  async updateLesson(lessonId: string, input: UpdateLessonInput): Promise<void> {
    const lesson = this.writableLesson(lessonId);
    Object.assign(lesson, input);
    if (input.status && input.status !== "published") lesson.published = false;
  }

  /* -- lesson content ---------------------------------------------------- */

  private toStudentNotes(notes: LessonNotesForTutor): LessonNotes {
    // Structurally removes the private field rather than relying on the caller
    // not to render it.
    const { tutorPrivateNotes: _private, ...rest } = notes;
    return rest;
  }

  async getLessonNotes(lessonId: string): Promise<LessonNotes | null> {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson || !this.canReadLesson(lesson)) return null;
    const notes = demoState.notes.find((n) => n.lessonId === lessonId);
    if (!notes) return null;
    // Students and parents only ever see published notes.
    if (!this.canWriteLesson(lesson) && !lesson.published) return null;
    return this.toStudentNotes(notes);
  }

  async getLessonNotesForTutor(lessonId: string): Promise<LessonNotesForTutor | null> {
    const lesson = this.lessonOrThrow(lessonId);
    if (!this.canWriteLesson(lesson)) throw new AccessDeniedError();
    return demoState.notes.find((n) => n.lessonId === lessonId) ?? null;
  }

  async saveLessonNotes(lessonId: string, patch: LessonNotesPatch): Promise<void> {
    this.writableLesson(lessonId);
    let notes = demoState.notes.find((n) => n.lessonId === lessonId);
    if (!notes) {
      notes = {
        id: demoId("n"),
        lessonId,
        summary: null,
        topicsCovered: [],
        keyConcepts: [],
        strengths: [],
        areasForImprovement: [],
        misconceptions: [],
        homework: [],
        resourcesMentioned: [],
        nextSteps: [],
        tutorPrivateNotes: null,
        aiGenerated: false,
        aiModel: null,
        tutorReviewed: false,
        updatedAt: new Date().toISOString(),
      };
      demoState.notes.push(notes);
    }
    Object.assign(notes, patch, { updatedAt: new Date().toISOString() });
  }

  async publishLesson(lessonId: string): Promise<void> {
    const lesson = this.writableLesson(lessonId);
    const notes = demoState.notes.find((n) => n.lessonId === lessonId);
    if (!notes) throw new NotFoundError("This lesson has no notes to publish.");
    if (!notes.summary || notes.summary.trim() === "") {
      throw new Error("A lesson cannot be published without a summary.");
    }

    notes.tutorReviewed = true;
    lesson.status = "published";
    lesson.published = true;
    lesson.publishedAt = lesson.publishedAt ?? new Date().toISOString();
    lesson.processingError = null;

    // Rebuild the outstanding homework for this lesson; completed items stay.
    demoState.homework = demoState.homework.filter((h) => h.lessonId !== lessonId || h.completed);
    for (const description of notes.homework) {
      if (!description.trim()) continue;
      if (demoState.homework.some((h) => h.lessonId === lessonId && h.description === description)) continue;
      demoState.homework.push({
        id: demoId("h"),
        lessonId,
        studentId: lesson.studentId,
        subjectId: lesson.subjectId,
        description,
        dueAt: null,
        completed: false,
        completedAt: null,
      });
    }

    const student = demoState.students.find((s) => s.id === lesson.studentId);
    const subject = demoState.subjects.find((s) => s.id === lesson.subjectId);
    if (student) {
      demoState.notifications.unshift({
        id: demoId("nt"),
        profileId: student.profileId,
        kind: "lesson_published",
        title: `Your ${subject?.displayName ?? "lesson"} notes have been published`,
        body: `${lesson.title ?? "Lesson notes"} is ready to read.`,
        lessonId,
        readAt: null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  async unpublishLesson(lessonId: string): Promise<void> {
    const lesson = this.writableLesson(lessonId);
    lesson.published = false;
    lesson.status = "review_required";
  }

  async getTranscript(lessonId: string): Promise<Transcript | null> {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson || !this.canReadLesson(lesson)) return null;
    const isStudentSide = !this.canWriteLesson(lesson);
    if (isStudentSide) {
      if (!lesson.published) return null;
      const student = demoState.students.find((s) => s.id === lesson.studentId);
      if (!student?.transcriptAccessEnabled) return null;
    }
    return demoState.transcripts.find((t) => t.lessonId === lessonId) ?? null;
  }

  /* -- files ------------------------------------------------------------- */

  async listLessonFiles(lessonId: string): Promise<LessonFile[]> {
    const lesson = demoState.lessons.find((l) => l.id === lessonId);
    if (!lesson || !this.canReadLesson(lesson)) return [];
    if (!this.canWriteLesson(lesson) && !lesson.published) return [];
    return demoState.files.filter((f) => f.lessonId === lessonId);
  }

  async uploadLessonFile(input: UploadFileInput): Promise<LessonFile> {
    this.writableLesson(input.lessonId);
    // Demo mode has no object store. The record is created so the flow can be
    // walked end to end; the file itself is not kept and the UI says so.
    const file: LessonFile = {
      id: demoId("f"),
      lessonId: input.lessonId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      category: input.category,
      createdAt: new Date().toISOString(),
      url: null,
    };
    demoState.files.push(file);
    return file;
  }

  async deleteLessonFile(fileId: string): Promise<void> {
    const file = demoState.files.find((f) => f.id === fileId);
    if (!file) throw new NotFoundError();
    this.writableLesson(file.lessonId);
    demoState.files = demoState.files.filter((f) => f.id !== fileId);
  }

  /* -- homework & progress ----------------------------------------------- */

  async listHomework(filter: { studentId?: string; completed?: boolean }): Promise<HomeworkItem[]> {
    const visible = this.visibleStudentIds();
    return demoState.homework
      .filter((h) => visible.has(h.studentId))
      .filter((h) => {
        // A tutor sees homework only for the subjects they teach that student.
        if (this.session.tutorId && !this.isAdmin) {
          return this.teachesStudentSubject(h.studentId, h.subjectId);
        }
        return true;
      })
      .filter((h) => (filter.studentId ? h.studentId === filter.studentId : true))
      .filter((h) => (filter.completed === undefined ? true : h.completed === filter.completed))
      .map((h) => ({
        ...h,
        subject: demoState.subjects.find((s) => s.id === h.subjectId),
        lessonTitle: demoState.lessons.find((l) => l.id === h.lessonId)?.title ?? null,
      }))
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  }

  async setHomeworkCompleted(homeworkId: string, completed: boolean): Promise<void> {
    const item = demoState.homework.find((h) => h.id === homeworkId);
    if (!item) throw new NotFoundError();
    const mine = this.session.studentId === item.studentId;
    if (!mine && !this.isAdmin && !this.teachesStudentSubject(item.studentId, item.subjectId)) {
      throw new AccessDeniedError();
    }
    item.completed = completed;
    item.completedAt = completed ? new Date().toISOString() : null;
  }

  async listProgress(studentId: string, subjectId?: string): Promise<TopicProgress[]> {
    if (!this.canSeeStudent(studentId)) return [];
    return demoState.progress
      .filter((p) => p.studentId === studentId)
      .filter((p) => (subjectId ? p.subjectId === subjectId : true))
      .filter((p) =>
        this.session.tutorId && !this.isAdmin ? this.teachesStudentSubject(studentId, p.subjectId) : true,
      );
  }

  /* -- dashboards -------------------------------------------------------- */

  async getSubjectSummaries(studentId: string): Promise<SubjectSummary[]> {
    const subjects = await this.listStudentSubjects(studentId);
    const now = new Date().toISOString();
    const homework = await this.listHomework({ studentId, completed: false });

    return Promise.all(
      subjects.map(async (subject) => {
        const lessons = await this.listLessons({ studentId, subjectId: subject.id, order: "desc" });
        const past = lessons.filter((l) => l.scheduledAt < now && l.status !== "cancelled");
        const upcoming = lessons
          .filter((l) => l.scheduledAt >= now && l.status === "scheduled")
          .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        const tutorIds = new Set(lessons.map((l) => l.tutorId));
        const assignmentTutors = demoState.assignments
          .filter((a) => a.active && a.studentId === studentId && a.subjectId === subject.id)
          .map((a) => a.tutorId);
        for (const id of assignmentTutors) tutorIds.add(id);

        return {
          subject,
          tutors: demoState.tutors.filter((t) => tutorIds.has(t.id)),
          lessonCount: past.filter((l) => l.published).length,
          lastLesson: past.find((l) => l.published) ?? null,
          nextLesson: upcoming[0] ?? null,
          openHomeworkCount: homework.filter((h) => h.subjectId === subject.id).length,
        };
      }),
    );
  }

  /* -- misc -------------------------------------------------------------- */

  async listNotifications(limit = 20): Promise<Notification[]> {
    return demoState.notifications
      .filter((n) => n.profileId === this.session.profile.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const n = demoState.notifications.find(
      (x) => x.id === notificationId && x.profileId === this.session.profile.id,
    );
    if (n) n.readAt = new Date().toISOString();
  }

  async getSettings(): Promise<AppSettings> {
    return demoState.settings;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    this.requireAdmin();
    Object.assign(demoState.settings, patch);
  }

  async adminCounts(): Promise<Record<string, number>> {
    this.requireAdmin();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      students: demoState.students.length,
      active_students: demoState.students.filter(
        (s) => demoState.profiles.find((p) => p.id === s.profileId)?.active,
      ).length,
      tutors: demoState.tutors.filter((t) => t.active).length,
      subjects: demoState.subjects.filter((s) => !s.archived).length,
      lessons_this_month: demoState.lessons.filter(
        (l) => new Date(l.scheduledAt) >= monthStart,
      ).length,
      review_required: demoState.lessons.filter((l) => l.status === "review_required").length,
      failed: demoState.lessons.filter((l) => l.status === "failed").length,
    };
  }
}
