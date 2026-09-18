/* ==========================================================================
   Supabase repository
   --------------------------------------------------------------------------
   Reads and writes as the signed-in user. There is deliberately no
   authorisation logic in this file: every query runs under Row Level Security,
   so an unauthorised read returns no rows and an unauthorised write is
   rejected by Postgres. Restating the rules here would only create a second
   place for them to drift.

   The one exception is the tutor/student split on lesson notes, which is a
   different *relation* rather than a different filter: students read the
   `student_lesson_notes` view, which has no private-notes column at all.
   ========================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";

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
import {
  mapFile,
  mapHomework,
  mapLesson,
  mapNotes,
  mapNotification,
  mapProfile,
  mapProgress,
  mapStudent,
  mapSubject,
  mapTranscript,
  mapParent,
  mapTutor,
} from "@/lib/data/mappers";
import type {
  Order,
  Parent,
  OrderPayment,
  OrderStatus,
  AppSettings,
  Assignment,
  HomeworkItem,
  Lesson,
  LessonFile,
  LessonNotes,
  LessonNotesForTutor,
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
  IaCreditEntry,
  IaCreditLedger,
  IaReviewRecord,
  IaSubmission,
  IaSubmissionWithReviews,
  WiseUnmatchedTransfer,
} from "@/lib/types";
import type { IaReview } from "@/lib/ia/schema";
import { settleWiseTransfer } from "@/lib/payments/wise-settle";

/* `students` holds two foreign keys to `profiles` — `profile_id` and
   `consent_recorded_by` — so a bare `profiles(*)` embed is ambiguous and
   PostgREST refuses the whole query with PGRST201 rather than guessing. The
   constraint name pins it to the one we mean. `tutors` and `parents` have a
   single link each and need no such hint. */
const STUDENT_PROFILE = `profile:profiles!students_profile_id_fkey(*)`;

const LESSON_SELECT = `
  *,
  subject:subjects(*),
  tutor:tutors(*, profile:profiles(*)),
  student:students(*, ${STUDENT_PROFILE})
`;

const STUDENT_SELECT = `*, ${STUDENT_PROFILE}`;

/** `tutors` links to `profiles` once, so this needs no disambiguation. */
const TUTOR_SELECT = `*, profile:profiles(*)`;
const PARENT_SELECT = `*, profile:profiles(*)`;

/** Signed URLs are minted per read and expire quickly — a lesson board should
 *  not be forwardable a week later. */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

function fail(context: string, error: { message: string; code?: string } | null): never {
  if (error?.code === "42501" || error?.code === "PGRST301") {
    throw new AccessDeniedError();
  }
  throw new Error(`${context}: ${error?.message ?? "unknown database error"}`);
}

export class SupabaseRepository implements Repository {
  private readonly db: SupabaseClient;
  readonly session: PortalSession;

  constructor(db: SupabaseClient, session: PortalSession) {
    this.db = db;
    this.session = session;
  }

  /* -- catalogue --------------------------------------------------------- */

  async listSubjects(includeArchived = false): Promise<Subject[]> {
    let q = this.db.from("subjects").select("*").order("curriculum").order("name");
    if (!includeArchived) q = q.eq("archived", false);
    const { data, error } = await q;
    if (error) fail("Could not load subjects", error);
    return (data ?? []).map(mapSubject);
  }

  async getSubject(subjectId: string): Promise<Subject | null> {
    const { data, error } = await this.db.from("subjects").select("*").eq("id", subjectId).maybeSingle();
    if (error) fail("Could not load the subject", error);
    return data ? mapSubject(data) : null;
  }

  async createSubject(input: SubjectInput): Promise<Subject> {
    const { data, error } = await this.db
      .from("subjects")
      .insert({
        name: input.name,
        curriculum: input.curriculum,
        level: input.level,
        division: input.division,
      })
      .select("*")
      .single();
    if (error) fail("Could not create the subject", error);
    return mapSubject(data);
  }

  async updateSubject(
    subjectId: string,
    input: Partial<SubjectInput> & { archived?: boolean },
  ): Promise<Subject> {
    const { data, error } = await this.db
      .from("subjects")
      .update({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.curriculum !== undefined ? { curriculum: input.curriculum } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.division !== undefined ? { division: input.division } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      })
      .eq("id", subjectId)
      .select("*")
      .single();
    if (error) fail("Could not update the subject", error);
    return mapSubject(data);
  }

  /* -- people ------------------------------------------------------------ */

  async listStudents(search?: string): Promise<Student[]> {
    const { data, error } = await this.db.from("students").select(STUDENT_SELECT);
    if (error) fail("Could not load students", error);
    const students = (data ?? []).map(mapStudent);
    if (!search) return students.sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));
    const q = search.toLowerCase();
    return students
      .filter(
        (s) =>
          s.profile.fullName.toLowerCase().includes(q) ||
          s.profile.email.toLowerCase().includes(q) ||
          (s.school ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));
  }

  async getStudent(studentId: string): Promise<Student | null> {
    const { data, error } = await this.db
      .from("students")
      .select(STUDENT_SELECT)
      .eq("id", studentId)
      .maybeSingle();
    if (error) fail("Could not load the student", error);
    // RLS returning nothing is indistinguishable from a bad id, and it should
    // stay that way — telling an unauthorised caller that a record exists is
    // itself a leak.
    return data ? mapStudent(data) : null;
  }

  /**
   * Entitlement, resolved the same way the database resolves it.
   *
   * `has_question_bank_access()` is the authority — the API gate calls it too —
   * but the interface also has to explain the answer, so the pieces behind it
   * are read alongside: the subscription row if there is one, and the hours.
   */
  async getQuestionBankAccess(studentId: string): Promise<QuestionBankAccess> {
    const [row, minutes, settings] = await Promise.all([
      this.db
        .from("question_bank_access")
        .select("granted, expires_at, note, granted_at")
        .eq("student_id", studentId)
        .maybeSingle(),
      this.db.rpc("student_pooled_minutes", { p_student_id: studentId }),
      this.db.from("app_settings").select("question_bank_free_hours").maybeSingle(),
    ]);

    const pooledHours = Math.round(((minutes.data as number | null) ?? 0) / 6) / 10;
    const freeAtHours =
      (settings.data as { question_bank_free_hours?: number } | null)
        ?.question_bank_free_hours ?? 20;

    const sub = row.data as
      | { granted: boolean; expires_at: string | null; note: string | null; granted_at: string }
      | null;

    const liveSubscription =
      !!sub && sub.granted && (!sub.expires_at || new Date(sub.expires_at) > new Date());
    const byHours = pooledHours >= freeAtHours;

    return {
      granted: liveSubscription || byHours,
      // A paid subscription is named ahead of the hours when both apply: it is
      // the one with an expiry date somebody may need to act on.
      source: liveSubscription ? "subscription" : byHours ? "pooled-hours" : "none",
      expiresAt: sub?.expires_at ?? null,
      note: sub?.note ?? null,
      grantedAt: sub?.granted_at ?? null,
      pooledHours,
      freeAtHours,
      hasSubscriptionRow: !!sub,
    };
  }

  /* -- orders ------------------------------------------------------------
     RLS restricts these to administrators, so the filtering here is for the
     screen rather than for safety. The unmatched case is deliberately a
     `student_id is null` test rather than a join: an order with no student is
     the thing being looked for, not a missing row. */

  private orderFrom(row: Record<string, unknown>): Order {
    const student = row.students as { profiles?: { first_name?: string; last_name?: string } } | null;
    const profile = student?.profiles;
    const name = profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() : "";
    return {
      id: row.id as string,
      provider: (row.provider as string) ?? "stripe",
      skuSlug: row.sku_slug as string,
      skuName: row.sku_name as string,
      plan: row.plan === "instalments" ? "instalments" : "full",
      quantity: (row.quantity as number) ?? 1,
      instalmentMonths: (row.instalment_months as number | null) ?? null,
      instalmentsPaid: (row.instalments_paid as number) ?? 0,
      currency: (row.currency as string) ?? "usd",
      amountTotalMinor: (row.amount_total_minor as number) ?? 0,
      amountPaidMinor: (row.amount_paid_minor as number) ?? 0,
      taxAmountMinor: (row.tax_amount_minor as number) ?? 0,
      status: row.status as Order["status"],
      buyerEmail: (row.buyer_email as string) ?? "",
      buyerName: (row.buyer_name as string | null) ?? null,
      buyerCountry: (row.buyer_country as string | null) ?? null,
      sourceSite: (row.source_site as string | null) ?? null,
      studentId: (row.student_id as string | null) ?? null,
      studentName: name || null,
      claimedAt: (row.claimed_at as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      paymentReference: (row.payment_reference as string | null) ?? null,
      createdAt: row.created_at as string,
      grantsQuestionBankDays: (row.grants_question_bank_days as number | null) ?? null,
    };
  }

  private static readonly ORDER_COLUMNS =
    "id, provider, sku_slug, sku_name, plan, quantity, instalment_months, instalments_paid, currency, amount_total_minor, amount_paid_minor, tax_amount_minor, status, buyer_email, buyer_name, buyer_country, source_site, student_id, claimed_at, note, payment_reference, created_at, grants_question_bank_days, students ( profiles ( first_name, last_name ) )";

  async listOrders(filter?: { status?: OrderStatus[]; unmatchedOnly?: boolean }): Promise<Order[]> {
    let query = this.db
      .from("orders")
      .select(SupabaseRepository.ORDER_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(500);

    if (filter?.status?.length) query = query.in("status", filter.status);
    if (filter?.unmatchedOnly) query = query.is("student_id", null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.orderFrom(row as unknown as Record<string, unknown>));
  }

  async listOrdersForStudent(studentId: string): Promise<Order[]> {
    const { data, error } = await this.db
      .from("orders")
      .select(SupabaseRepository.ORDER_COLUMNS)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.orderFrom(row as unknown as Record<string, unknown>));
  }

  async getOrderPayments(orderId: string): Promise<OrderPayment[]> {
    const { data, error } = await this.db
      .from("order_payments")
      .select("id, kind, amount_minor, currency, occurred_at, detail")
      .eq("order_id", orderId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as OrderPayment["kind"],
      amountMinor: r.amount_minor as number,
      currency: r.currency as string,
      occurredAt: r.occurred_at as string,
      detail: (r.detail as string | null) ?? null,
    }));
  }

  async linkOrderToStudent(orderId: string, studentId: string): Promise<void> {
    // Attach first, then let the SQL function apply whatever the order granted.
    // The rule about a renewal extending rather than resetting lives there, and
    // restating it here would give two answers to one question.
    const { error } = await this.db
      .from("orders")
      .update({ student_id: studentId, claimed_at: new Date().toISOString() })
      .eq("id", orderId);
    if (error) throw new Error(error.message);

    const { data: student } = await this.db
      .from("students")
      .select("profile_id")
      .eq("id", studentId)
      .maybeSingle();
    const profileId = (student as { profile_id?: string } | null)?.profile_id;
    if (profileId) {
      await this.db.rpc("claim_orders_for_profile", { p_profile_id: profileId });
    }
  }

  async unlinkOrder(orderId: string): Promise<void> {
    // Deliberately does not revoke anything. Access may also be earned through
    // pooled hours, and taking it away here would be guessing.
    const { error } = await this.db
      .from("orders")
      .update({ student_id: null, claimed_at: null, claimed_by: null })
      .eq("id", orderId);
    if (error) throw new Error(error.message);
  }

  async listUnmatchedWiseTransfers(): Promise<WiseUnmatchedTransfer[]> {
    const { data, error } = await this.db
      .from("wise_unmatched_transfers")
      .select("id, wise_transfer_id, amount_minor, currency, reference_received, occurred_at")
      .is("matched_order_id", null)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      wiseTransferId: r.wise_transfer_id as string,
      amountMinor: r.amount_minor as number,
      currency: r.currency as string,
      referenceReceived: (r.reference_received as string | null) ?? null,
      occurredAt: r.occurred_at as string,
    }));
  }

  async attachWiseTransferToOrder(transferId: string, orderId: string): Promise<void> {
    const { data: transfer, error: findError } = await this.db
      .from("wise_unmatched_transfers")
      .select("wise_transfer_id, amount_minor, currency, matched_order_id")
      .eq("id", transferId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!transfer) throw new NotFoundError("That transfer no longer exists.");
    if (transfer.matched_order_id) throw new Error("That transfer has already been matched.");

    // Reuses exactly what the webhook would have done for an automatic match
    // — the same status transition, the same entitlement, the same admin
    // notifications on anything that still needs a person.
    const settled = await settleWiseTransfer(this.db, orderId, {
      transferId: transfer.wise_transfer_id,
      amountMinor: transfer.amount_minor,
      currency: transfer.currency,
    });
    if (!settled.ok) throw new Error(settled.reason);

    const { error } = await this.db
      .from("wise_unmatched_transfers")
      .update({
        matched_order_id: orderId,
        matched_at: new Date().toISOString(),
        matched_by: this.session.profile.id,
      })
      .eq("id", transferId);
    if (error) throw new Error(error.message);
  }

  async setQuestionBankAccess(
    studentId: string,
    input: { granted: boolean; expiresAt: string | null; note: string | null },
  ): Promise<void> {
    const { error } = await this.db.from("question_bank_access").upsert(
      {
        student_id: studentId,
        granted: input.granted,
        expires_at: input.expiresAt,
        note: input.note,
        granted_by: this.session.profile.id,
      },
      { onConflict: "student_id" },
    );
    // RLS restricts this to administrators, so a refusal here is the policy
    // doing its job rather than a fault.
    if (error) fail("Could not update question bank access", error);
  }

  /* ==========================================================================
     IA review
     --------------------------------------------------------------------------
     Reads run as the signed-in user, so RLS decides whose coursework is
     visible. The two writes that must not be forgeable — spending a credit and
     storing a review — go through SQL functions and the API's service-role
     client respectively, for the reason set out in the migration: a client
     that could write these directly could have a review without paying for
     one.
     ========================================================================== */

  async getIaCredits(studentId: string): Promise<IaCreditLedger> {
    const [balance, entries] = await Promise.all([
      this.db.rpc("ia_credit_balance", { p_student_id: studentId }),
      this.db
        .from("ia_credit_entries")
        .select("id, delta, reason, note, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (entries.error) fail("Could not load IA credits", entries.error);

    return {
      balance: (balance.data as number | null) ?? 0,
      entries: (entries.data ?? []).map(
        (row: Record<string, unknown>): IaCreditEntry => ({
          id: row.id as string,
          delta: row.delta as number,
          reason: row.reason as IaCreditEntry["reason"],
          note: (row.note as string | null) ?? null,
          createdAt: row.created_at as string,
        }),
      ),
    };
  }

  async grantIaCredits(studentId: string, count: number, note: string): Promise<void> {
    if (count === 0) return;
    const { error } = await this.db.from("ia_credit_entries").insert({
      student_id: studentId,
      delta: count,
      reason: count > 0 ? "admin_grant" : "correction",
      note,
      created_by: this.session.profile.id,
    });
    if (error) fail("Could not change IA review credits", error);
  }

  async spendIaCredit(studentId: string, note: string): Promise<number> {
    /* The balance check and the ledger write are one statement inside the
       database. Doing it in two round trips from here is how a student with
       one credit and two browser tabs gets two reviews. */
    const { data, error } = await this.db.rpc("spend_ia_credit", {
      p_student_id: studentId,
      p_note: note,
    });
    if (error) fail("Could not spend an IA review credit", error);
    return (data as number | null) ?? 0;
  }

  async listIaSubmissions(
    filter: { studentId?: string; escalatedOnly?: boolean } = {},
  ): Promise<IaSubmissionWithReviews[]> {
    let query = this.db
      .from("ia_submissions")
      .select(`*, reviews:ia_reviews(*)`)
      .order("created_at", { ascending: false });

    if (filter.studentId) query = query.eq("student_id", filter.studentId);
    if (filter.escalatedOnly) query = query.not("professional_review_requested_at", "is", null);

    const { data, error } = await query;
    if (error) fail("Could not load IA submissions", error);
    return (data ?? []).map(mapIaSubmissionRow);
  }

  async getIaSubmission(submissionId: string): Promise<IaSubmissionWithReviews | null> {
    const { data, error } = await this.db
      .from("ia_submissions")
      .select(`*, reviews:ia_reviews(*)`)
      .eq("id", submissionId)
      .maybeSingle();
    if (error) fail("Could not load that IA submission", error);
    return data ? mapIaSubmissionRow(data as Record<string, unknown>) : null;
  }

  async createIaSubmission(input: CreateIaSubmissionInput): Promise<IaSubmission> {
    const [month, year] = input.session.split(" ");
    const { data, error } = await this.db
      .from("ia_submissions")
      .insert({
        student_id: input.studentId,
        subject: input.subject,
        level: input.level,
        session_month: month,
        session_year: Number.parseInt(year ?? "", 10),
        stage: input.stage,
        storage_path: input.storagePath,
        file_name: input.fileName,
        file_size: input.fileSize,
        file_hash: input.fileHash,
        word_count: input.wordCount,
        student_note: input.studentNote,
      })
      .select("*")
      .single();

    if (error || !data) fail("Could not record that submission", error);
    return mapIaSubmission(data as Record<string, unknown>);
  }

  async setIaSubmissionStatus(
    submissionId: string,
    status: IaSubmission["status"],
    failureNote: string | null = null,
  ): Promise<void> {
    const { error } = await this.db
      .from("ia_submissions")
      .update({ status, failure_note: failureNote })
      .eq("id", submissionId);
    if (error) fail("Could not update that submission", error);
  }

  async saveIaReview(submissionId: string, review: unknown): Promise<string> {
    const body = review as IaReview;
    const { data, error } = await this.db
      .from("ia_reviews")
      .insert({
        submission_id: submissionId,
        rubric_id: body.rubricId,
        pack_version: body.assessmentPackVersion,
        pack_checksum: body.assessmentPackChecksum,
        prompt_version: body.promptVersion,
        model_id: body.modelId,
        mode: body.mode,
        calibration_status: body.calibrationStatus,
        total: body.total,
        max_total: body.maxTotal,
        body,
      })
      .select("id")
      .single();

    if (error || !data) fail("Could not store that review", error);
    return (data as { id: string }).id;
  }

  async requestProfessionalReview(submissionId: string): Promise<void> {
    const { error } = await this.db
      .from("ia_submissions")
      .update({ professional_review_requested_at: new Date().toISOString() })
      .eq("id", submissionId);
    if (error) fail("Could not record that request", error);
  }

  async listTutors(search?: string): Promise<Tutor[]> {
    const { data, error } = await this.db.from("tutors").select(TUTOR_SELECT);
    if (error) fail("Could not load tutors", error);
    const tutors = (data ?? []).map(mapTutor);
    if (!search) return tutors.sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));
    const q = search.toLowerCase();
    return tutors.filter(
      (t) => t.profile.fullName.toLowerCase().includes(q) || t.profile.email.toLowerCase().includes(q),
    );
  }

  async getTutor(tutorId: string): Promise<Tutor | null> {
    const { data, error } = await this.db
      .from("tutors")
      .select(TUTOR_SELECT)
      .eq("id", tutorId)
      .maybeSingle();
    if (error) fail("Could not load the tutor", error);
    return data ? mapTutor(data) : null;
  }

  async listProfiles(role?: Profile["role"]): Promise<Profile[]> {
    let q = this.db.from("profiles").select("*").order("first_name");
    if (role) q = q.eq("role", role);
    const { data, error } = await q;
    if (error) fail("Could not load profiles", error);
    return (data ?? []).map(mapProfile);
  }

  async setProfileActive(profileId: string, active: boolean): Promise<void> {
    const { error } = await this.db.from("profiles").update({ active }).eq("id", profileId);
    if (error) fail("Could not update the account", error);
    // Tutors carry their own active flag, used for scheduling.
    await this.db.from("tutors").update({ active }).eq("profile_id", profileId);
  }

  /* -- assignments ------------------------------------------------------- */

  async listAssignments(filter: { tutorId?: string; studentId?: string } = {}): Promise<Assignment[]> {
    let q = this.db
      .from("tutor_student_subjects")
      .select(
        `*, tutor:tutors(*, profile:profiles(*)), student:students(*, ${STUDENT_PROFILE}), subject:subjects(*)`,
      )
      .order("created_at", { ascending: false });
    if (filter.tutorId) q = q.eq("tutor_id", filter.tutorId);
    if (filter.studentId) q = q.eq("student_id", filter.studentId);
    const { data, error } = await q;
    if (error) fail("Could not load assignments", error);
    return (data ?? []).map((row) => ({
      id: row.id,
      tutorId: row.tutor_id,
      studentId: row.student_id,
      subjectId: row.subject_id,
      active: row.active,
      createdAt: row.created_at,
      tutor: row.tutor ? mapTutor(row.tutor) : undefined,
      student: row.student ? mapStudent(row.student) : undefined,
      subject: row.subject ? mapSubject(row.subject) : undefined,
    }));
  }

  async createAssignment(input: { tutorId: string; studentId: string; subjectId: string }): Promise<void> {
    const { error } = await this.db.from("tutor_student_subjects").upsert(
      {
        tutor_id: input.tutorId,
        student_id: input.studentId,
        subject_id: input.subjectId,
        active: true,
      },
      { onConflict: "tutor_id,student_id,subject_id" },
    );
    if (error) fail("Could not create the assignment", error);

    const { error: ssError } = await this.db.from("student_subjects").upsert(
      { student_id: input.studentId, subject_id: input.subjectId, active: true },
      { onConflict: "student_id,subject_id" },
    );
    if (ssError) fail("Could not add the subject to the student", ssError);
  }

  async setAssignmentActive(assignmentId: string, active: boolean): Promise<void> {
    const { error } = await this.db
      .from("tutor_student_subjects")
      .update({ active })
      .eq("id", assignmentId);
    if (error) fail("Could not update the assignment", error);
  }

  async listStudentSubjects(studentId: string): Promise<Subject[]> {
    const { data, error } = await this.db
      .from("student_subjects")
      .select("subject:subjects(*)")
      .eq("student_id", studentId)
      .eq("active", true);
    if (error) fail("Could not load the student's subjects", error);
    const subjects = (data ?? [])
      .map((row) => (row as { subject: unknown }).subject)
      .filter(Boolean)
      .map(mapSubject);

    // A tutor should only see the subjects they teach this student. RLS lets
    // them read the student_subjects rows (they are not sensitive), so the
    // narrowing happens here.
    if (this.session.profile.role === "tutor") {
      const assignments = await this.listAssignments({
        tutorId: this.session.tutorId ?? undefined,
        studentId,
      });
      const allowed = new Set(assignments.filter((a) => a.active).map((a) => a.subjectId));
      return subjects.filter((s) => allowed.has(s.id));
    }
    return subjects;
  }

  async addStudentSubject(studentId: string, subjectId: string): Promise<void> {
    const { error } = await this.db
      .from("student_subjects")
      .upsert({ student_id: studentId, subject_id: subjectId, active: true }, { onConflict: "student_id,subject_id" });
    if (error) fail("Could not add the subject", error);
  }

  /* -- families ---------------------------------------------------------- */

  async listParents(search?: string): Promise<Parent[]> {
    const { data, error } = await this.db.from("parents").select(PARENT_SELECT);
    if (error) fail("Could not load parents", error);
    const parents = (data ?? []).map(mapParent);
    if (!search) return parents.sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));
    const q = search.toLowerCase();
    return parents.filter(
      (p) => p.profile.fullName.toLowerCase().includes(q) || p.profile.email.toLowerCase().includes(q),
    );
  }

  async listParentsForStudent(studentId: string): Promise<Parent[]> {
    const { data, error } = await this.db
      .from("parent_students")
      .select(`parent:parents(${PARENT_SELECT})`)
      .eq("student_id", studentId);
    if (error) fail("Could not load the student's parents", error);
    return (data ?? [])
      .map((row) => mapParent((row as unknown as { parent: unknown }).parent))
      .sort((a, b) => a.profile.fullName.localeCompare(b.profile.fullName));
  }

  async linkParentToStudent(
    parentId: string,
    studentId: string,
    relationship: string | null,
  ): Promise<void> {
    const { error } = await this.db
      .from("parent_students")
      .upsert(
        { parent_id: parentId, student_id: studentId, relationship },
        { onConflict: "parent_id,student_id" },
      );
    if (error) fail("Could not link the parent", error);
  }

  async unlinkParentFromStudent(parentId: string, studentId: string): Promise<void> {
    const { error } = await this.db
      .from("parent_students")
      .delete()
      .eq("parent_id", parentId)
      .eq("student_id", studentId);
    if (error) fail("Could not remove the link", error);
  }

  /* -- lessons ----------------------------------------------------------- */

  private async decorate(rows: unknown[]): Promise<LessonWithContext[]> {
    const lessons = rows.map((row) => ({ row, lesson: mapLesson(row) }));
    const ids = lessons.map(({ lesson }) => lesson.id);
    if (ids.length === 0) return [];

    // Three small companion queries rather than three correlated subselects:
    // PostgREST cannot express the latter, and at dashboard sizes the round
    // trips cost less than shipping the joined rows would.
    const [notes, transcripts, files] = await Promise.all([
      this.db.from("lesson_notes").select("lesson_id").in("lesson_id", ids),
      this.db.from("transcripts").select("lesson_id, processing_status").in("lesson_id", ids),
      this.db.from("lesson_files").select("lesson_id").in("lesson_id", ids),
    ]);

    const withNotes = new Set((notes.data ?? []).map((r) => r.lesson_id as string));
    const withTranscript = new Set(
      (transcripts.data ?? []).filter((r) => r.processing_status === "ready").map((r) => r.lesson_id as string),
    );
    const fileCounts = new Map<string, number>();
    for (const r of files.data ?? []) {
      const key = r.lesson_id as string;
      fileCounts.set(key, (fileCounts.get(key) ?? 0) + 1);
    }

    return lessons.map(({ row, lesson }) => {
      const r = row as Record<string, unknown>;
      return {
        ...lesson,
        subject: mapSubject(r.subject),
        tutor: mapTutor(r.tutor),
        student: mapStudent(r.student),
        hasNotes: withNotes.has(lesson.id),
        hasTranscript: withTranscript.has(lesson.id),
        fileCount: fileCounts.get(lesson.id) ?? 0,
      };
    });
  }

  async listLessons(filter: LessonFilter): Promise<LessonWithContext[]> {
    let q = this.db
      .from("lessons")
      .select(LESSON_SELECT)
      .order("scheduled_at", { ascending: filter.order === "asc" });

    if (filter.studentId) q = q.eq("student_id", filter.studentId);
    if (filter.tutorId) q = q.eq("tutor_id", filter.tutorId);
    if (filter.subjectId) q = q.eq("subject_id", filter.subjectId);
    if (filter.status) {
      q = Array.isArray(filter.status) ? q.in("status", filter.status) : q.eq("status", filter.status);
    }
    if (filter.from) q = q.gte("scheduled_at", filter.from);
    if (filter.to) q = q.lt("scheduled_at", filter.to);
    if (filter.limit && !filter.search) q = q.limit(filter.limit);

    const { data, error } = await q;
    if (error) fail("Could not load lessons", error);

    let decorated = await this.decorate(data ?? []);
    if (filter.search) {
      // Searching across the joined names is done here rather than with a
      // PostgREST `or` filter, which cannot reach through an embedded table.
      const term = filter.search.trim().toLowerCase();
      decorated = decorated.filter(
        (l) =>
          (l.title ?? "").toLowerCase().includes(term) ||
          l.subject.displayName.toLowerCase().includes(term) ||
          l.student.profile.fullName.toLowerCase().includes(term) ||
          l.tutor.profile.fullName.toLowerCase().includes(term),
      );
      if (filter.limit) decorated = decorated.slice(0, filter.limit);
    }
    return decorated;
  }

  async getLesson(lessonId: string): Promise<LessonWithContext | null> {
    const { data, error } = await this.db
      .from("lessons")
      .select(LESSON_SELECT)
      .eq("id", lessonId)
      .maybeSingle();
    if (error) fail("Could not load the lesson", error);
    if (!data) return null;
    const [decorated] = await this.decorate([data]);
    return decorated ?? null;
  }

  async createLesson(input: CreateLessonInput): Promise<Lesson> {
    const { data, error } = await this.db
      .from("lessons")
      .insert({
        student_id: input.studentId,
        tutor_id: input.tutorId,
        subject_id: input.subjectId,
        title: input.title,
        scheduled_at: input.scheduledAt,
        duration_minutes: input.durationMinutes,
        meeting_url: input.meetingUrl,
        meeting_platform: input.meetingPlatform,
        notetaker_enabled: input.notetakerEnabled,
        status: "scheduled",
      })
      .select("*")
      .single();
    if (error) fail("Could not create the lesson", error);
    return mapLesson(data);
  }

  async updateLesson(lessonId: string, input: UpdateLessonInput): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt;
    if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes;
    if (input.meetingUrl !== undefined) patch.meeting_url = input.meetingUrl;
    if (input.meetingPlatform !== undefined) patch.meeting_platform = input.meetingPlatform;
    if (input.notetakerEnabled !== undefined) patch.notetaker_enabled = input.notetakerEnabled;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status !== "published") patch.published = false;
    }
    if (Object.keys(patch).length === 0) return;

    const { error } = await this.db.from("lessons").update(patch).eq("id", lessonId);
    if (error) fail("Could not update the lesson", error);
  }

  async setLessonMeeting(lessonId: string, input: LessonMeetingInput): Promise<void> {
    const { error } = await this.db
      .from("lessons")
      .update({
        meeting_url: input.meetingUrl,
        meeting_platform: input.meetingPlatform,
        google_event_id: input.googleEventId,
        google_calendar_id: input.googleCalendarId,
        google_owner_id: input.googleOwnerId,
        meet_link_managed: input.managed,
      })
      .eq("id", lessonId);
    if (error) fail("Could not attach the meeting to the lesson", error);
  }

  /* -- lesson content ---------------------------------------------------- */

  async getLessonNotes(lessonId: string): Promise<LessonNotes | null> {
    const role = this.session.profile.role;
    if (role === "tutor" || role === "admin") {
      const notes = await this.getLessonNotesForTutor(lessonId);
      if (!notes) return null;
      const { tutorPrivateNotes: _private, ...rest } = notes;
      return rest;
    }
    // The student-facing view. It has no tutor_private_notes column, so this
    // path cannot leak it regardless of what the caller does with the result.
    const { data, error } = await this.db
      .from("student_lesson_notes")
      .select("*")
      .eq("lesson_id", lessonId)
      .maybeSingle();
    if (error) fail("Could not load the lesson notes", error);
    if (!data) return null;
    const { tutorPrivateNotes: _omit, ...rest } = mapNotes(data);
    return rest;
  }

  async getLessonNotesForTutor(lessonId: string): Promise<LessonNotesForTutor | null> {
    const { data, error } = await this.db
      .from("lesson_notes")
      .select("*")
      .eq("lesson_id", lessonId)
      .maybeSingle();
    if (error) fail("Could not load the lesson notes", error);
    return data ? mapNotes(data) : null;
  }

  async saveLessonNotes(lessonId: string, patch: LessonNotesPatch): Promise<void> {
    const row: Record<string, unknown> = { lesson_id: lessonId };
    if (patch.summary !== undefined) row.summary = patch.summary;
    if (patch.topicsCovered !== undefined) row.topics_covered = patch.topicsCovered;
    if (patch.keyConcepts !== undefined) row.key_concepts = patch.keyConcepts;
    if (patch.strengths !== undefined) row.strengths = patch.strengths;
    if (patch.areasForImprovement !== undefined) row.areas_for_improvement = patch.areasForImprovement;
    if (patch.misconceptions !== undefined) row.misconceptions = patch.misconceptions;
    if (patch.homework !== undefined) row.homework = patch.homework;
    if (patch.resourcesMentioned !== undefined) row.resources_mentioned = patch.resourcesMentioned;
    if (patch.nextSteps !== undefined) row.next_steps = patch.nextSteps;
    if (patch.tutorPrivateNotes !== undefined) row.tutor_private_notes = patch.tutorPrivateNotes;

    const { error } = await this.db.from("lesson_notes").upsert(row, { onConflict: "lesson_id" });
    if (error) fail("Could not save the lesson notes", error);
  }

  async publishLesson(lessonId: string): Promise<void> {
    const { error } = await this.db.rpc("publish_lesson", { p_lesson_id: lessonId });
    if (error) {
      if (error.code === "42501") throw new AccessDeniedError("You cannot publish this lesson.");
      if (error.code === "23514") throw new Error("A lesson cannot be published without a summary.");
      if (error.code === "P0002") throw new NotFoundError(error.message);
      fail("Could not publish the lesson", error);
    }
  }

  async unpublishLesson(lessonId: string): Promise<void> {
    const { error } = await this.db.rpc("unpublish_lesson", { p_lesson_id: lessonId });
    if (error) fail("Could not unpublish the lesson", error);
  }

  async getTranscript(lessonId: string): Promise<Transcript | null> {
    const { data, error } = await this.db
      .from("transcripts")
      .select("*")
      .eq("lesson_id", lessonId)
      .maybeSingle();
    if (error) fail("Could not load the transcript", error);
    return data ? mapTranscript(data) : null;
  }

  /* -- files ------------------------------------------------------------- */

  async listLessonFiles(lessonId: string): Promise<LessonFile[]> {
    const { data, error } = await this.db
      .from("lesson_files")
      .select("*")
      .eq("lesson_id", lessonId)
      .order("created_at", { ascending: true });
    if (error) fail("Could not load the lesson files", error);
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const paths = rows.map((r) => r.storage_path as string);
    const { data: signed } = await this.db.storage
      .from("lesson-files")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    const urlByPath = new Map<string, string>();
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
    }
    return rows.map((r) => mapFile(r, urlByPath.get(r.storage_path as string) ?? null));
  }

  async uploadLessonFile(input: UploadFileInput): Promise<LessonFile> {
    const safeName = input.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const path = `lessons/${input.lessonId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await this.db.storage
      .from("lesson-files")
      .upload(path, input.body, { contentType: input.fileType, upsert: false });
    if (uploadError) throw new Error(`Could not upload the file: ${uploadError.message}`);

    const { data, error } = await this.db
      .from("lesson_files")
      .insert({
        lesson_id: input.lessonId,
        uploaded_by: this.session.profile.id,
        file_name: input.fileName,
        file_type: input.fileType,
        file_size: input.fileSize,
        storage_path: path,
        category: input.category,
      })
      .select("*")
      .single();
    if (error) {
      // Do not leave an orphan object behind if the row could not be written.
      await this.db.storage.from("lesson-files").remove([path]);
      fail("Could not record the uploaded file", error);
    }
    return mapFile(data, null);
  }

  async deleteLessonFile(fileId: string): Promise<void> {
    const { data, error } = await this.db
      .from("lesson_files")
      .select("storage_path")
      .eq("id", fileId)
      .maybeSingle();
    if (error) fail("Could not find the file", error);
    if (!data) throw new NotFoundError();

    const { error: deleteError } = await this.db.from("lesson_files").delete().eq("id", fileId);
    if (deleteError) fail("Could not delete the file", deleteError);
    await this.db.storage.from("lesson-files").remove([data.storage_path as string]);
  }

  /* -- homework & progress ----------------------------------------------- */

  async listHomework(filter: { studentId?: string; completed?: boolean }): Promise<HomeworkItem[]> {
    let q = this.db
      .from("homework_items")
      .select("*, subject:subjects(*), lesson:lessons(title)")
      .order("due_at", { ascending: true, nullsFirst: false });
    if (filter.studentId) q = q.eq("student_id", filter.studentId);
    if (filter.completed !== undefined) q = q.eq("completed", filter.completed);
    const { data, error } = await q;
    if (error) fail("Could not load homework", error);
    return (data ?? []).map(mapHomework);
  }

  async setHomeworkCompleted(homeworkId: string, completed: boolean): Promise<void> {
    const { error } = await this.db
      .from("homework_items")
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq("id", homeworkId);
    if (error) fail("Could not update the homework", error);
  }

  async listProgress(studentId: string, subjectId?: string): Promise<TopicProgress[]> {
    let q = this.db
      .from("student_topic_progress")
      .select("*")
      .eq("student_id", studentId)
      .order("topic");
    if (subjectId) q = q.eq("subject_id", subjectId);
    const { data, error } = await q;
    if (error) fail("Could not load progress", error);
    return (data ?? []).map(mapProgress);
  }

  /* -- dashboards -------------------------------------------------------- */

  async getSubjectSummaries(studentId: string): Promise<SubjectSummary[]> {
    const [subjects, lessons, homework, assignments] = await Promise.all([
      this.listStudentSubjects(studentId),
      this.listLessons({ studentId, order: "desc" }),
      this.listHomework({ studentId, completed: false }),
      this.listAssignments({ studentId }),
    ]);
    const now = new Date().toISOString();

    return subjects.map((subject) => {
      const forSubject = lessons.filter((l) => l.subjectId === subject.id);
      const past = forSubject.filter((l) => l.scheduledAt < now && l.status !== "cancelled");
      const upcoming = forSubject
        .filter((l) => l.scheduledAt >= now && l.status === "scheduled")
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      const tutors = assignments
        .filter((a) => a.active && a.subjectId === subject.id && a.tutor)
        .map((a) => a.tutor!)
        .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

      return {
        subject,
        tutors,
        lessonCount: past.filter((l) => l.published).length,
        lastLesson: past.find((l) => l.published) ?? null,
        nextLesson: upcoming[0] ?? null,
        openHomeworkCount: homework.filter((h) => h.subjectId === subject.id).length,
      };
    });
  }

  /* -- misc -------------------------------------------------------------- */

  async listNotifications(limit = 20): Promise<Notification[]> {
    const { data, error } = await this.db
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("Could not load notifications", error);
    return (data ?? []).map(mapNotification);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await this.db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);
    if (error) fail("Could not update the notification", error);
  }

  async getSettings(): Promise<AppSettings> {
    const { data, error } = await this.db.from("app_settings").select("*").maybeSingle();
    if (error) fail("Could not load settings", error);
    return {
      notetakerEnabledGlobally: data?.notetaker_enabled_globally === true,
      notetakerDisplayName: data?.notetaker_display_name ?? "Own Your Study AI Notetaker",
      requireGuardianConsentUnder18: data?.require_guardian_consent_under_18 !== false,
      transcriptRetentionDays: data?.transcript_retention_days ?? 365,
      mediaRetentionHours: data?.media_retention_hours ?? 24,
      questionBankFreeHours: data?.question_bank_free_hours ?? 20,
      autoInvitePaidBuyers: data?.auto_invite_paid_buyers ?? true,
    };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const row: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
    if (patch.notetakerEnabledGlobally !== undefined)
      row.notetaker_enabled_globally = patch.notetakerEnabledGlobally;
    if (patch.notetakerDisplayName !== undefined) row.notetaker_display_name = patch.notetakerDisplayName;
    if (patch.requireGuardianConsentUnder18 !== undefined)
      row.require_guardian_consent_under_18 = patch.requireGuardianConsentUnder18;
    if (patch.autoInvitePaidBuyers !== undefined)
      row.auto_invite_paid_buyers = patch.autoInvitePaidBuyers;
    if (patch.questionBankFreeHours !== undefined)
      row.question_bank_free_hours = patch.questionBankFreeHours;
    if (patch.transcriptRetentionDays !== undefined)
      row.transcript_retention_days = patch.transcriptRetentionDays;
    if (patch.mediaRetentionHours !== undefined) row.media_retention_hours = patch.mediaRetentionHours;

    const { error } = await this.db.from("app_settings").upsert(row, { onConflict: "id" });
    if (error) fail("Could not save settings", error);
  }

  async adminCounts(): Promise<Record<string, number>> {
    const { data, error } = await this.db.rpc("admin_overview_counts");
    if (error) fail("Could not load the overview", error);
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries((data ?? {}) as Record<string, unknown>)) {
      counts[key] = Number(value) || 0;
    }
    return counts;
  }
}


/* --------------------------------------------------------------------------
   IA row mappers
   --------------------------------------------------------------------------
   Kept here rather than in mappers.ts because they are the only mappers that
   read a jsonb column back into a typed document. The cast is unavoidable —
   Postgres hands back `unknown` — but it is confined to these two functions
   rather than spread across every page that displays a review.
   -------------------------------------------------------------------------- */

function mapIaSubmission(row: Record<string, unknown>): IaSubmission {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    subject: row.subject as IaSubmission["subject"],
    level: row.level as IaSubmission["level"],
    session: `${row.session_month as string} ${row.session_year as number}`,
    stage: row.stage as IaSubmission["stage"],
    fileName: row.file_name as string,
    fileSize: row.file_size as number,
    fileHash: row.file_hash as string,
    wordCount: (row.word_count as number | null) ?? null,
    studentNote: (row.student_note as string | null) ?? null,
    status: row.status as IaSubmission["status"],
    failureNote: (row.failure_note as string | null) ?? null,
    professionalReviewRequestedAt:
      (row.professional_review_requested_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapIaReview(row: Record<string, unknown>): IaReviewRecord {
  return {
    id: row.id as string,
    submissionId: row.submission_id as string,
    rubricId: row.rubric_id as string,
    packVersion: (row.pack_version as string | null) ?? null,
    mode: row.mode as IaReviewRecord["mode"],
    calibrationStatus: "uncalibrated",
    total: (row.total as number | null) ?? null,
    maxTotal: row.max_total as number,
    body: row.body as IaReview,
    createdAt: row.created_at as string,
  };
}

function mapIaSubmissionRow(row: Record<string, unknown>): IaSubmissionWithReviews {
  const reviews = ((row.reviews as Record<string, unknown>[] | null) ?? [])
    .map(mapIaReview)
    // Newest first. PostgREST does not order an embedded relation for us, and
    // a page that shows "your review" wants the latest one, not the first.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { submission: mapIaSubmission(row), reviews };
}
