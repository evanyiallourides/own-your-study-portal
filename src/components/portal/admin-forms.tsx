"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import {
  createAssignment,
  createSubject,
  inviteUser,
  setAssignmentActive,
  setProfileActive,
  setSubjectArchived,
  updateSettings,
} from "@/lib/actions/admin";
import { ROLE_LABEL } from "@/lib/navigation";
import type { AppSettings, Student, Subject, Tutor, UserRole } from "@/lib/types";

/* -- shared plumbing ------------------------------------------------------ */

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, message?: string) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      if (message) setDone(message);
      router.refresh();
    });
  };

  return { pending, error, done, run, setError, setDone };
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {error ? <ErrorState title="Could not do that" description={error} /> : null}
      {done ? (
        <p
          role="status"
          className="rounded-[10px] border border-success/25 bg-success-wash px-4 py-2.5 text-sm font-medium text-success"
        >
          {done}
        </p>
      ) : null}
    </>
  );
}

/* -- invitations ---------------------------------------------------------- */

export function InviteForm({
  role,
  demo,
  heading,
}: {
  role: UserRole;
  demo: boolean;
  heading: string;
}) {
  const { pending, error, done, run } = useAction();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => inviteUser({ email, firstName, lastName, role }),
          `Invitation sent to ${email}.`,
        );
      }}
    >
      <div>
        <h2 className="font-display text-lg font-semibold">{heading}</h2>
        <p className="mt-1 text-sm text-ink-500">
          They receive an email with a one-time link. The account is created as a{" "}
          {ROLE_LABEL[role].toLowerCase()} when they use it — nobody can sign themselves up.
        </p>
      </div>

      {demo ? (
        <p className="rounded-[8px] border border-warning/25 bg-warning-wash px-3 py-2 text-sm text-warning">
          Invitations need a Supabase project and a service-role key. In demo mode this form is
          here to show the flow, but no email can be sent.
        </p>
      ) : null}

      <Feedback error={error} done={done} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`first-${role}`} className="field-label">
            First name
          </label>
          <input
            id={`first-${role}`}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="field"
            maxLength={80}
          />
        </div>
        <div>
          <label htmlFor={`last-${role}`} className="field-label">
            Last name
          </label>
          <input
            id={`last-${role}`}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="field"
            maxLength={80}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`email-${role}`} className="field-label">
          Email
        </label>
        <input
          id={`email-${role}`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="name@example.com"
        />
      </div>

      <Button type="submit" variant="solid" disabled={pending}>
        {pending ? "Sending…" : `Invite ${ROLE_LABEL[role].toLowerCase()}`}
      </Button>
    </form>
  );
}

/* -- account activation --------------------------------------------------- */

export function ToggleActiveButton({
  profileId,
  active,
  name,
}: {
  profileId: string;
  active: boolean;
  name: string;
}) {
  const { pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (active && !confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-ink-500 transition-colors hover:text-danger"
      >
        Deactivate
      </button>
    );
  }

  if (!active) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => setProfileActive({ profileId, active: true }))}
        className="text-sm font-semibold text-accent hover:underline"
      >
        {pending ? "Working…" : "Reactivate"}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-ink-500">Deactivate {name}?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => setProfileActive({ profileId, active: false }))}
        className="font-semibold text-danger hover:underline"
      >
        {pending ? "Working…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="font-medium text-ink-500 hover:underline"
      >
        Cancel
      </button>
    </span>
  );
}

/* -- subjects ------------------------------------------------------------- */

export function SubjectForm() {
  const { pending, error, done, run } = useAction();
  const [name, setName] = useState("");
  const [curriculum, setCurriculum] = useState("IB");
  const [level, setLevel] = useState("");

  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createSubject({ name, curriculum, level }), "Subject created.");
        setName("");
        setLevel("");
      }}
    >
      <div>
        <h2 className="font-display text-lg font-semibold">Add a subject</h2>
        <p className="mt-1 text-sm text-ink-500">
          Curriculum, name and level are shown together — &ldquo;IB Chemistry HL&rdquo;.
        </p>
      </div>

      <Feedback error={error} done={done} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="curriculum" className="field-label">
            Curriculum
          </label>
          <input
            id="curriculum"
            required
            value={curriculum}
            onChange={(e) => setCurriculum(e.target.value)}
            className="field"
            placeholder="IB"
            list="curricula"
          />
          <datalist id="curricula">
            {["IB", "A Level", "GCSE", "AP", "University", "IGCSE", "ATAR"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="subject-name" className="field-label">
            Subject
          </label>
          <input
            id="subject-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
            placeholder="Chemistry"
          />
        </div>
        <div>
          <label htmlFor="level" className="field-label">
            Level <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="field"
            placeholder="HL"
          />
        </div>
      </div>

      <Button type="submit" variant="solid" disabled={pending}>
        {pending ? "Creating…" : "Create subject"}
      </Button>
    </form>
  );
}

export function ArchiveSubjectButton({ subject }: { subject: Subject }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => setSubjectArchived({ subjectId: subject.id, archived: !subject.archived }))}
      className="text-sm font-medium text-ink-500 transition-colors hover:text-accent"
    >
      {pending ? "Working…" : subject.archived ? "Restore" : "Archive"}
    </button>
  );
}

/* -- assignments -----------------------------------------------------------
   The one form that actually grants access, so it says so plainly.
   ------------------------------------------------------------------------ */

export function AssignmentForm({
  tutors,
  students,
  subjects,
}: {
  tutors: Tutor[];
  students: Student[];
  subjects: Subject[];
}) {
  const { pending, error, done, run } = useAction();
  const [tutorId, setTutorId] = useState(tutors[0]?.id ?? "");
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");

  const tutorName = tutors.find((t) => t.id === tutorId)?.profile.fullName;
  const studentName = students.find((s) => s.id === studentId)?.profile.fullName;
  const subjectName = subjects.find((s) => s.id === subjectId)?.displayName;

  if (tutors.length === 0 || students.length === 0 || subjects.length === 0) {
    return (
      <div className="card p-5">
        <p className="text-sm text-ink-500">
          You need at least one tutor, one student and one subject before an assignment can be made.
        </p>
      </div>
    );
  }

  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createAssignment({ tutorId, studentId, subjectId }), "Assignment created.");
      }}
    >
      <div>
        <h2 className="font-display text-lg font-semibold">Assign a tutor</h2>
        <p className="mt-1 text-sm text-ink-500">
          This is what grants access. A tutor can see a student only through an active assignment,
          and only in the subject named here.
        </p>
      </div>

      <Feedback error={error} done={done} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="a-student" className="field-label">
            Student
          </label>
          <select
            id="a-student"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="field"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.profile.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a-tutor" className="field-label">
            Tutor
          </label>
          <select
            id="a-tutor"
            value={tutorId}
            onChange={(e) => setTutorId(e.target.value)}
            className="field"
          >
            {tutors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.profile.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a-subject" className="field-label">
            Subject
          </label>
          <select
            id="a-subject"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="field"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-ink-700">
        <strong>{tutorName}</strong> will be able to see <strong>{studentName}</strong>&rsquo;s{" "}
        <strong>{subjectName}</strong> lessons, notes and transcripts — and nothing else of theirs.
      </p>

      <Button type="submit" variant="solid" disabled={pending}>
        {pending ? "Saving…" : "Create assignment"}
      </Button>
    </form>
  );
}

export function ToggleAssignmentButton({
  assignmentId,
  active,
}: {
  assignmentId: string;
  active: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => setAssignmentActive({ assignmentId, active: !active }))}
      className="text-sm font-medium text-ink-500 transition-colors hover:text-accent"
    >
      {pending ? "Working…" : active ? "Revoke access" : "Restore access"}
    </button>
  );
}

/* -- settings ------------------------------------------------------------- */

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const { pending, error, done, run } = useAction();
  const [form, setForm] = useState(settings);

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateSettings(form), "Settings saved.");
      }}
    >
      <Feedback error={error} done={done} />

      <fieldset className="card space-y-5 p-5">
        <legend className="px-1 font-display text-lg font-semibold">AI Notetaker</legend>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.notetakerEnabledGlobally}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, notetakerEnabledGlobally: e.target.checked }))
            }
            className="mt-1 h-4 w-4 shrink-0 accent-[#635bff]"
          />
          <span>
            <span className="font-medium text-ink">Enabled for the organisation</span>
            <span className="mt-1 block text-sm text-ink-500">
              A master switch. With this off, no bot is scheduled for any lesson regardless of what
              a tutor or a student has agreed to.
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="bot-name" className="field-label">
            Name shown in the meeting
          </label>
          <input
            id="bot-name"
            value={form.notetakerDisplayName}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, notetakerDisplayName: e.target.value }))
            }
            className="field"
            maxLength={80}
          />
          <p className="mt-1.5 text-xs text-ink-300">
            Everyone in the call sees this name in the participant list. It must make clear what the
            participant is — recording without disclosure is not something this system supports.
          </p>
        </div>
      </fieldset>

      <fieldset className="card space-y-5 p-5">
        <legend className="px-1 font-display text-lg font-semibold">Consent</legend>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.requireGuardianConsentUnder18}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, requireGuardianConsentUnder18: e.target.checked }))
            }
            className="mt-1 h-4 w-4 shrink-0 accent-[#635bff]"
          />
          <span>
            <span className="font-medium text-ink">
              Require guardian consent for students under 18
            </span>
            <span className="mt-1 block text-sm text-ink-500">
              Whether a guardian&rsquo;s consent is needed is set per student. This decides the
              default for new students.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="card space-y-5 p-5">
        <legend className="px-1 font-display text-lg font-semibold">Retention</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="transcript-days" className="field-label">
              Keep transcripts for (days)
            </label>
            <input
              id="transcript-days"
              type="number"
              min={1}
              max={3650}
              value={form.transcriptRetentionDays}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  transcriptRetentionDays: Number(e.target.value),
                }))
              }
              className="field"
            />
          </div>
          <div>
            <label htmlFor="media-hours" className="field-label">
              Keep meeting media for (hours)
            </label>
            <input
              id="media-hours"
              type="number"
              min={0}
              max={720}
              value={form.mediaRetentionHours}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, mediaRetentionHours: Number(e.target.value) }))
              }
              className="field"
            />
            <p className="mt-1.5 text-xs text-ink-300">
              Audio and video exist only long enough to produce a transcript. The portal keeps no
              playable recording and offers no video library.
            </p>
          </div>
        </div>
      </fieldset>

      <Button type="submit" variant="solid" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
