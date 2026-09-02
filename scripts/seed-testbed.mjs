#!/usr/bin/env node
/* ==========================================================================
   Testbed
   --------------------------------------------------------------------------
   Gives the two test students a plausible term's worth of teaching with the
   owner as their tutor, so both sides of the portal have something real to
   show. Without it every dashboard is empty and there is nothing to click.

   It also sets a password on each *test student* account. Invited accounts
   have no password — the app has no set-a-password screen yet — so without
   this you could only ever reach a test student through a magic link. The
   owner's account is never touched: that one is yours, and you reach it
   through the invitation in your inbox.

     node scripts/seed-testbed.mjs           # create it
     node scripts/seed-testbed.mjs --down    # remove all of it

   Everything it creates is tagged in the database, and --down removes exactly
   what it made and nothing else. Run --down before real students exist.

   Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
   ========================================================================== */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

if (!URL_ || !SERVICE) {
  console.error("\nNeed NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n");
  process.exit(1);
}

const db = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const down = process.argv.slice(2).includes("--down");

/* The two accounts this script is allowed to touch. Anything else is somebody
   real, and gets left alone. */
const OWNER_EMAIL = "evanyiallourides@gmail.com";
const STUDENTS = [
  { email: "evanyiallourides+test1@gmail.com", first: "Test", last: "StudentOne" },
  { email: "evanyiallourides+test2@gmail.com", first: "Test", last: "StudentTwo" },
];

/* Obviously a test credential, and only ever set on the two accounts above.
   Never reuse it for a real person. */
const TEST_PASSWORD = "TestStudent!2026";

/* Marks every row this script creates, so --down is exact. */
const TAG = "[testbed]";

const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString();
const days = (n) => hours(n * 24);

/* -- lookups -------------------------------------------------------------- */

async function usersByEmail() {
  const found = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    for (const u of data.users) if (u.email) found.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) return found;
  }
}

async function detailId(table, profileId) {
  const { data } = await db.from(table).select("id").eq("profile_id", profileId).maybeSingle();
  return data?.id ?? null;
}

/* -- teardown ------------------------------------------------------------- */

async function teardown() {
  console.log(`\nRemoving everything tagged ${TAG}\n`);

  const { data: subjects } = await db.from("subjects").select("id, name").like("name", `%${TAG}`);
  const subjectIds = (subjects ?? []).map((s) => s.id);

  if (subjectIds.length === 0) {
    console.log("  Nothing to remove.\n");
    return;
  }

  /* Lessons cascade their notes, files and homework; the subject itself is
     `on delete restrict` from lessons, so lessons must go first. */
  const { data: lessons } = await db.from("lessons").select("id").in("subject_id", subjectIds);
  for (const lesson of lessons ?? []) await db.from("lessons").delete().eq("id", lesson.id);
  console.log(`  ${(lessons ?? []).length} lesson(s) removed`);

  await db.from("homework_items").delete().in("subject_id", subjectIds);
  await db.from("student_topic_progress").delete().in("subject_id", subjectIds);
  await db.from("tutor_student_subjects").delete().in("subject_id", subjectIds);
  await db.from("student_subjects").delete().in("subject_id", subjectIds);

  for (const id of subjectIds) await db.from("subjects").delete().eq("id", id);
  console.log(`  ${subjectIds.length} subject(s) removed`);

  /* Notifications carry no subject, so they are matched by their tag. */
  const { data: notes } = await db.from("notifications").delete().like("title", `%${TAG}`).select("id");
  console.log(`  ${(notes ?? []).length} notification(s) removed`);

  console.log("\nDone. The accounts themselves are untouched.\n");
}

/* -- setup ---------------------------------------------------------------- */

async function seed() {
  const users = await usersByEmail();

  const owner = users.get(OWNER_EMAIL);
  if (!owner) throw new Error(`No account for ${OWNER_EMAIL}. Run: npm run team -- --send`);

  const tutorId = await detailId("tutors", owner.id);
  if (!tutorId) throw new Error(`${OWNER_EMAIL} has no tutor record. Run: npm run team -- --send`);

  console.log(`\nTestbed · ${URL_}`);
  console.log(`Tutor    ${OWNER_EMAIL} (owner, teaching)\n`);

  /* -- the students ------------------------------------------------------ */

  const students = [];
  for (const person of STUDENTS) {
    const user = users.get(person.email);
    if (!user) {
      console.log(`  skip   ${person.email} — no account. Run: npm run team -- --send`);
      continue;
    }

    /* An invited account has no password, and there is no screen in the app
       to set one. For a test account, set it here. */
    const { error } = await db.auth.admin.updateUserById(user.id, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not set the password for ${person.email}: ${error.message}`);

    const studentId = await detailId("students", user.id);
    if (!studentId) throw new Error(`${person.email} has no student record.`);

    /* Fill in the profile so the dashboards are not full of blanks. */
    await db
      .from("profiles")
      .update({ first_name: person.first, last_name: person.last })
      .eq("id", user.id);

    students.push({ ...person, studentId, profileId: user.id });
    console.log(`  ok     ${person.email} — password set, ready to sign in`);
  }

  if (students.length === 0) throw new Error("Neither test student has an account yet.");

  /* -- subjects ---------------------------------------------------------- */

  const subjectSpecs = [
    { name: `Mathematics ${TAG}`, curriculum: "IB", level: "HL", division: "Sciences" },
    { name: `Physics ${TAG}`, curriculum: "IB", level: "HL", division: "Sciences" },
  ];

  const subjects = [];
  for (const spec of subjectSpecs) {
    const { data: already } = await db.from("subjects").select("id").eq("name", spec.name).maybeSingle();
    if (already) {
      subjects.push(already.id);
      continue;
    }
    const { data, error } = await db.from("subjects").insert(spec).select("id").single();
    if (error) throw new Error(`Could not create ${spec.name}: ${error.message}`);
    subjects.push(data.id);
  }
  const [maths, physics] = subjects;
  console.log(`\n  2 subjects: Mathematics HL, Physics HL`);

  /* -- assignments ------------------------------------------------------- */
  /* StudentOne gets both subjects, StudentTwo only physics — so the tutor
     views differ and the subject gate is visible in the UI, not just in the
     tests. */

  const enrolments = [
    { student: students[0], subject: maths },
    { student: students[0], subject: physics },
    ...(students[1] ? [{ student: students[1], subject: physics }] : []),
  ];

  for (const { student, subject } of enrolments) {
    await db
      .from("student_subjects")
      .upsert(
        { student_id: student.studentId, subject_id: subject, active: true },
        { onConflict: "student_id,subject_id" },
      );
    await db.from("tutor_student_subjects").upsert(
      { tutor_id: tutorId, student_id: student.studentId, subject_id: subject, active: true },
      { onConflict: "tutor_id,student_id,subject_id" },
    );
  }
  console.log(`  ${enrolments.length} assignments to you as tutor`);

  /* -- lessons ----------------------------------------------------------- */

  const one = students[0];
  const two = students[1];

  const lessonSpecs = [
    {
      label: "published write-up, three days ago",
      student: one,
      subject: maths,
      title: "Integration by parts",
      scheduled_at: days(-3),
      status: "published",
      published: true,
      published_at: days(-2),
      notes: {
        summary:
          "Worked through integration by parts, starting from the product rule so the formula " +
          "was derived rather than memorised. Good progress on choosing u and dv.",
        topics_covered: ["Integration by parts", "Choosing u and dv", "LIATE as a heuristic"],
        key_concepts: ["The formula is the product rule, rearranged and integrated"],
        strengths: ["Derived the formula independently once prompted to start from the product rule"],
        areas_for_improvement: ["Sign errors when dv is a trigonometric function"],
        misconceptions: ["Initially treated LIATE as a rule rather than a rule of thumb"],
        homework: ["Exercise 7C, questions 1-8", "One past-paper question on definite integrals"],
        next_steps: ["Move on to integration by substitution next session"],
        tutor_private_notes:
          "Was tired at the start; picked up once we moved to the whiteboard. Worth keeping " +
          "sessions after 5pm rather than straight after school.",
        tutor_reviewed: true,
      },
      homework: [
        { description: "Exercise 7C, questions 1-8", due_at: days(2), completed: false },
        { description: "One past-paper question on definite integrals", due_at: days(4), completed: false },
      ],
    },
    {
      label: "drafted but NOT published — this is the one to review",
      student: one,
      subject: maths,
      title: "Integration by substitution",
      scheduled_at: days(-1),
      status: "review_required",
      published: false,
      notes: {
        summary:
          "Covered substitution, including when to use it in preference to parts. The chain " +
          "rule connection landed well.",
        topics_covered: ["Integration by substitution", "Recognising the derivative inside"],
        key_concepts: ["Substitution undoes the chain rule"],
        strengths: ["Spotted the inner function unprompted in four of six examples"],
        areas_for_improvement: ["Forgetting to change the limits on definite integrals"],
        misconceptions: [],
        homework: ["Exercise 8A, all questions"],
        next_steps: ["A mixed exercise so the choice between methods has to be made"],
        tutor_private_notes: "Draft — check the wording on limits before releasing this.",
        tutor_reviewed: false,
      },
      homework: [],
    },
    {
      label: "starts in about an hour — tests the join window",
      student: one,
      subject: physics,
      title: "Simple harmonic motion",
      scheduled_at: hours(1),
      status: "scheduled",
      published: false,
      meeting_url: "https://meet.google.com/abc-defg-hij",
      notes: null,
      homework: [],
    },
    {
      label: "next week",
      student: one,
      subject: maths,
      title: "Mixed integration practice",
      scheduled_at: days(7),
      status: "scheduled",
      published: false,
      meeting_url: "https://meet.google.com/klm-nopq-rst",
      notes: null,
      homework: [],
    },
    ...(two
      ? [
          {
            label: "second student, so your tutor list is not a list of one",
            student: two,
            subject: physics,
            title: "Circular motion",
            scheduled_at: days(2),
            status: "scheduled",
            published: false,
            meeting_url: "https://meet.google.com/uvw-xyza-bcd",
            notes: null,
            homework: [],
          },
        ]
      : []),
  ];

  console.log("");
  for (const spec of lessonSpecs) {
    const { notes, homework, student, subject, label, ...lesson } = spec;

    const { data: created, error } = await db
      .from("lessons")
      .insert({
        ...lesson,
        student_id: student.studentId,
        tutor_id: tutorId,
        subject_id: subject,
        duration_minutes: 60,
        meeting_platform: "google_meet",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create "${lesson.title}": ${error.message}`);

    if (notes) {
      const { error: notesError } = await db
        .from("lesson_notes")
        .insert({ lesson_id: created.id, ai_generated: false, ...notes });
      if (notesError) throw new Error(`Notes for "${lesson.title}": ${notesError.message}`);
    }

    for (const item of homework) {
      await db.from("homework_items").insert({
        ...item,
        lesson_id: created.id,
        student_id: student.studentId,
        subject_id: subject,
      });
    }

    console.log(`  ${lesson.title.padEnd(32)} ${label}`);
  }

  /* A review notification, so the owner's dashboard has something waiting. */
  await db.from("notifications").insert({
    profile_id: owner.id,
    kind: "lesson_notes_ready_for_review",
    title: `Notes ready to review ${TAG}`,
    body: "Integration by substitution — drafted and waiting for you.",
  });

  /* -- what to do next --------------------------------------------------- */

  console.log(`\n  Sign in at ${APP_URL}/login\n`);
  console.log("  As a student");
  for (const student of students) console.log(`    ${student.email}`);
  console.log(`    password: ${TEST_PASSWORD}`);
  console.log("");
  console.log("  As the owner");
  console.log(`    ${OWNER_EMAIL} — use the invitation in your inbox.`);
  console.log("    It signs you in; after that use 'Email me a sign-in link'.");
  console.log("");
  console.log("  Try: sign in as the owner, open Integration by substitution,");
  console.log("  publish it, then reload the student — it appears. That single");
  console.log("  step is the whole product.");
  console.log("");
  console.log("  Run with --down to remove all of it.\n");
}

try {
  await (down ? teardown() : seed());
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
