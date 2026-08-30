import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DemoRepository } from "@/lib/data/demo-repository";
import { AccessDeniedError } from "@/lib/data/repository";
import { demoState, resetDemoState } from "@/lib/data/demo-store";
import type { PortalSession, UserRole } from "@/lib/types";

/* ==========================================================================
   Access rules
   --------------------------------------------------------------------------
   These exercise the demo repository, which restates in TypeScript the same
   rules the RLS migration expresses in SQL. They are not a substitute for
   testing the policies themselves against a real database — see the README —
   but they do hold the intended behaviour still: a student cannot reach
   another student's records, a tutor cannot reach an unassigned student, and
   nothing unpublished or private leaks to the people it is kept from.
   ========================================================================== */

function sessionFor(profileId: string): PortalSession {
  const profile = demoState.profiles.find((p) => p.id === profileId);
  assert.ok(profile, `demo profile ${profileId} should exist`);
  return {
    profile,
    studentId: demoState.students.find((s) => s.profileId === profileId)?.id ?? null,
    tutorId: demoState.tutors.find((t) => t.profileId === profileId)?.id ?? null,
    parentId: demoState.parents.find((p) => p.profileId === profileId)?.id ?? null,
    isDemo: true,
  };
}

const repoFor = (profileId: string) => new DemoRepository(sessionFor(profileId));

async function rejects(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AccessDeniedError);
}

beforeEach(() => resetDemoState());

describe("roles", () => {
  it("gives each demo account the role its dashboard expects", () => {
    const expected: Record<string, UserRole> = {
      "p-sophia": "student",
      "p-marcus": "student",
      "p-imogen": "tutor",
      "p-daniel": "tutor",
      "p-admin": "admin",
      "p-helen": "parent",
    };
    for (const [profileId, role] of Object.entries(expected)) {
      assert.equal(sessionFor(profileId).profile.role, role);
    }
  });
});

describe("a student", () => {
  it("sees their own lessons", async () => {
    const lessons = await repoFor("p-sophia").listLessons({});
    assert.ok(lessons.length > 0);
    assert.ok(lessons.every((l) => l.studentId === "s-sophia"));
  });

  it("cannot open another student's lesson", async () => {
    // Nothing is returned, and nothing distinguishes "not yours" from "does
    // not exist" — which is exactly how the RLS policy behaves.
    assert.equal(await repoFor("p-sophia").getLesson("l-alevel-1"), null);
  });

  it("cannot open another student's record", async () => {
    assert.equal(await repoFor("p-sophia").getStudent("s-marcus"), null);
  });

  it("does not see another student's homework", async () => {
    const homework = await repoFor("p-sophia").listHomework({});
    assert.ok(homework.every((h) => h.studentId === "s-sophia"));
  });

  it("cannot read notes for a lesson awaiting review", async () => {
    const notes = await repoFor("p-sophia").getLessonNotes("l-chem-9");
    assert.equal(notes, null, "unreviewed AI notes must not reach the student");
  });

  it("cannot read the transcript of an unpublished lesson", async () => {
    const transcript = await repoFor("p-sophia").getTranscript("l-chem-9");
    assert.equal(transcript, null);
  });

  it("never receives the tutor's private notes", async () => {
    const notes = await repoFor("p-sophia").getLessonNotes("l-chem-8");
    assert.ok(notes, "the published lesson should have notes");
    assert.equal(
      "tutorPrivateNotes" in notes,
      false,
      "the private field must be absent from the object, not merely empty",
    );
  });

  it("cannot reach the tutor-facing notes at all", async () => {
    await rejects(repoFor("p-sophia").getLessonNotesForTutor("l-chem-8"));
  });

  it("cannot see files on a lesson that has not been published", async () => {
    const files = await repoFor("p-sophia").listLessonFiles("l-chem-9");
    assert.deepEqual(files, []);
  });

  it("cannot list the whole student roll", async () => {
    const students = await repoFor("p-sophia").listStudents();
    assert.deepEqual(
      students.map((s) => s.id),
      ["s-sophia"],
    );
  });

  it("cannot use an admin-only operation", async () => {
    await rejects(repoFor("p-sophia").adminCounts());
    await rejects(
      repoFor("p-sophia").createSubject({
        name: "Physics",
        curriculum: "IB",
        level: "HL",
        division: null,
      }),
    );
  });
});

describe("a tutor", () => {
  it("sees only the students they are assigned to", async () => {
    const students = await repoFor("p-daniel").listStudents();
    assert.deepEqual(
      students.map((s) => s.id),
      ["s-sophia"],
      "Daniel teaches Sophia maths and nobody else",
    );
  });

  it("cannot open an unassigned student", async () => {
    assert.equal(await repoFor("p-daniel").getStudent("s-marcus"), null);
  });

  it("cannot open a lesson in a subject they do not teach that student", async () => {
    // Daniel teaches Sophia maths; this is her chemistry lesson.
    assert.equal(await repoFor("p-daniel").getLesson("l-chem-8"), null);
  });

  it("sees a lesson in the subject they do teach", async () => {
    const lesson = await repoFor("p-daniel").getLesson("l-math-3");
    assert.ok(lesson);
    assert.equal(lesson.subjectId, "sub-maths-aa-hl");
  });

  it("cannot edit notes on another tutor's lesson", async () => {
    await rejects(
      repoFor("p-daniel").saveLessonNotes("l-chem-8", { summary: "not mine to write" }),
    );
  });

  it("cannot publish another tutor's lesson", async () => {
    await rejects(repoFor("p-daniel").publishLesson("l-chem-9"));
  });

  it("cannot assign themselves a student", async () => {
    await rejects(
      repoFor("p-daniel").createAssignment({
        tutorId: "t-daniel",
        studentId: "s-marcus",
        subjectId: "sub-chem-alevel",
      }),
    );
  });

  it("sees unpublished lessons of their own students", async () => {
    const lesson = await repoFor("p-imogen").getLesson("l-chem-9");
    assert.ok(lesson);
    assert.equal(lesson.published, false, "the draft is visible to its own tutor");
  });

  it("reads their own private notes", async () => {
    const notes = await repoFor("p-imogen").getLessonNotesForTutor("l-chem-8");
    assert.ok(notes?.tutorPrivateNotes);
  });

  it("sees homework only for the subjects they teach", async () => {
    const homework = await repoFor("p-daniel").listHomework({});
    assert.ok(homework.length > 0);
    assert.ok(homework.every((h) => h.subjectId === "sub-maths-aa-hl"));
  });

  it("sees only the subjects they teach a shared student", async () => {
    const subjects = await repoFor("p-daniel").listStudentSubjects("s-sophia");
    assert.deepEqual(
      subjects.map((s) => s.id),
      ["sub-maths-aa-hl"],
    );
  });
});

describe("a parent", () => {
  it("sees their own child and no other", async () => {
    const students = await repoFor("p-helen").listStudents();
    assert.deepEqual(
      students.map((s) => s.id),
      ["s-sophia"],
    );
  });

  it("cannot open another family's lesson", async () => {
    assert.equal(await repoFor("p-helen").getLesson("l-alevel-1"), null);
  });

  it("cannot read a lesson still awaiting review", async () => {
    const notes = await repoFor("p-helen").getLessonNotes("l-chem-9");
    assert.equal(notes, null);
  });

  it("cannot reach the tutor's private notes", async () => {
    await rejects(repoFor("p-helen").getLessonNotesForTutor("l-chem-8"));
  });
});

describe("an admin", () => {
  it("sees every student", async () => {
    const students = await repoFor("p-admin").listStudents();
    assert.equal(students.length, demoState.students.length);
  });

  it("can read the overview counts", async () => {
    const counts = await repoFor("p-admin").adminCounts();
    assert.ok(typeof counts.students === "number");
    assert.ok(
      (counts.review_required ?? 0) >= 1,
      "the demo data includes lessons awaiting review",
    );
  });
});

describe("publishing", () => {
  it("releases the lesson, its notes and its homework in one step", async () => {
    const repo = repoFor("p-imogen");

    const before = await repoFor("p-sophia").getLessonNotes("l-chem-9");
    assert.equal(before, null, "nothing is visible before publishing");

    await repo.publishLesson("l-chem-9");

    const lesson = await repoFor("p-sophia").getLesson("l-chem-9");
    assert.equal(lesson?.published, true);
    assert.equal(lesson?.status, "published");

    const notes = await repoFor("p-sophia").getLessonNotes("l-chem-9");
    assert.ok(notes?.summary);
    assert.equal("tutorPrivateNotes" in (notes ?? {}), false);

    const homework = await repoFor("p-sophia").listHomework({ completed: false });
    assert.ok(
      homework.some((h) => h.lessonId === "l-chem-9"),
      "publishing should create the homework items",
    );

    const notifications = await repoFor("p-sophia").listNotifications();
    assert.ok(notifications.some((n) => n.lessonId === "l-chem-9" && n.kind === "lesson_published"));
  });

  it("refuses to publish a lesson with no summary", async () => {
    const repo = repoFor("p-imogen");
    await repo.saveLessonNotes("l-chem-9", { summary: "   " });
    await assert.rejects(repo.publishLesson("l-chem-9"), /without a summary/);
  });

  it("keeps completed homework when a lesson is republished", async () => {
    const tutor = repoFor("p-imogen");
    const student = repoFor("p-sophia");

    await tutor.publishLesson("l-chem-9");
    const [first] = await student.listHomework({ completed: false });
    assert.ok(first);
    await student.setHomeworkCompleted(first.id, true);

    await tutor.publishLesson("l-chem-9");
    const completed = await student.listHomework({ completed: true });
    assert.ok(
      completed.some((h) => h.id === first.id),
      "a republish must not resurrect finished work",
    );
  });

  it("hides the lesson again when it is unpublished", async () => {
    const tutor = repoFor("p-imogen");
    await tutor.publishLesson("l-chem-9");
    await tutor.unpublishLesson("l-chem-9");
    const notes = await repoFor("p-sophia").getLessonNotes("l-chem-9");
    assert.equal(notes, null);
  });
});

describe("homework", () => {
  it("lets a student tick off their own item", async () => {
    const repo = repoFor("p-sophia");
    const [item] = await repo.listHomework({ completed: false });
    assert.ok(item);
    await repo.setHomeworkCompleted(item.id, true);
    const done = await repo.listHomework({ completed: true });
    assert.ok(done.some((h) => h.id === item.id));
  });

  it("does not let a student tick off someone else's", async () => {
    const marcusItem = demoState.homework.find((h) => h.studentId === "s-marcus");
    assert.ok(marcusItem);
    await rejects(repoFor("p-sophia").setHomeworkCompleted(marcusItem.id, true));
  });
});
