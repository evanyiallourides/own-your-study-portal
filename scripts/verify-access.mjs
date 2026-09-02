#!/usr/bin/env node
/* ==========================================================================
   Verify the access rules against the real database
   --------------------------------------------------------------------------
   RUNBOOK stage 7. The demo repository mirrors these rules and the unit tests
   cover them, but RLS is SQL and SQL is only truly tested by a database. This
   script is that test.

   It builds a small, complete world — two students, one tutor, two subjects,
   three lessons, two sets of notes — signs in as each person with a real JWT
   through the anon key, and asks the questions that matter. Nothing is checked
   through the service role, because the service role bypasses every policy and
   would pass no matter how wrong the rules were.

   Everything it creates, it deletes. The three accounts are throwaway and are
   removed on the way out, including when a check fails.

     node scripts/verify-access.mjs

   Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
   SUPABASE_SERVICE_ROLE_KEY in portal/.env.local.

   Exit code 0 means every rule held. Anything else means a student can see
   something they should not, and you should not put real students in front of
   it until the failing policy is fixed.
   ========================================================================== */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!URL || !ANON || !SERVICE) {
  console.error(
    "\nNeed NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and\n" +
      "SUPABASE_SERVICE_ROLE_KEY in portal/.env.local.\n",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* -- results -------------------------------------------------------------- */

const checks = [];
let failures = 0;

function check(what, passed, detail) {
  checks.push({ what, passed, detail });
  if (!passed) failures += 1;
  console.log(`  ${passed ? " ok " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
}

/* A tag that makes every row this script creates identifiable, so a run that
   dies halfway leaves something greppable rather than a mystery. */
const TAG = `rlscheck-${randomUUID().slice(0, 8)}`;
const created = { users: [], lessons: [], assignments: [], subjects: [] };

/* -- helpers -------------------------------------------------------------- */

async function makeUser(role, firstName) {
  const email = `evanyiallourides+${TAG}-${firstName.toLowerCase()}@gmail.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, first_name: firstName, last_name: "Throwaway" },
  });
  if (error) throw new Error(`Could not create the ${role} test account: ${error.message}`);
  created.users.push(data.user.id);
  return { id: data.user.id, email, password };
}

/** A client carrying that person's own JWT — the only way to exercise RLS. */
async function signIn({ email, password }) {
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

async function detailRow(table, profileId) {
  const { data, error } = await admin.from(table).select("id").eq("profile_id", profileId).single();
  if (error) throw new Error(`No ${table} row for ${profileId}: ${error.message}`);
  return data.id;
}

async function makeSubject(name) {
  const { data, error } = await admin
    .from("subjects")
    .insert({ name: `${name} (${TAG})`, curriculum: "IB", level: "HL" })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the subject: ${error.message}`);
  created.subjects.push(data.id);
  return data.id;
}

async function makeLesson(fields) {
  const { data, error } = await admin
    .from("lessons")
    .insert({ scheduled_at: new Date().toISOString(), duration_minutes: 60, ...fields })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create a lesson: ${error.message}`);
  created.lessons.push(data.id);
  return data.id;
}

async function cleanup() {
  /* Order matters only for the subjects, which lessons reference with
     `on delete restrict`. Everything else cascades from the user. */
  for (const id of created.lessons) await admin.from("lessons").delete().eq("id", id);
  for (const id of created.assignments) {
    await admin.from("tutor_student_subjects").delete().eq("id", id);
  }
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  for (const id of created.subjects) await admin.from("subjects").delete().eq("id", id);
}

/* -- the world ------------------------------------------------------------ */

async function main() {
  console.log(`\nAccess rules · ${URL}`);
  console.log(`Building a throwaway world tagged ${TAG}\n`);

  const studentAUser = await makeUser("student", "Alpha");
  const studentBUser = await makeUser("student", "Beta");
  const tutorUser = await makeUser("tutor", "Tutor");

  const studentA = await detailRow("students", studentAUser.id);
  const studentB = await detailRow("students", studentBUser.id);
  const tutor = await detailRow("tutors", tutorUser.id);

  const maths = await makeSubject("Mathematics");
  const physics = await makeSubject("Physics");

  /* The single row that grants the tutor sight of Alpha, and only in maths. */
  const { data: assignment, error: assignmentError } = await admin
    .from("tutor_student_subjects")
    .insert({ tutor_id: tutor, student_id: studentA, subject_id: maths, active: true })
    .select("id")
    .single();
  if (assignmentError) throw new Error(`Could not assign: ${assignmentError.message}`);
  created.assignments.push(assignment.id);

  /* Alpha, maths, published — the one lesson Alpha is entitled to read. */
  const published = await makeLesson({
    student_id: studentA,
    tutor_id: tutor,
    subject_id: maths,
    title: "Published maths lesson",
    status: "published",
    published: true,
    published_at: new Date().toISOString(),
  });

  /* Alpha, maths, written up but not yet released. */
  const unpublished = await makeLesson({
    student_id: studentA,
    tutor_id: tutor,
    subject_id: maths,
    title: "Unpublished write-up",
    status: "review_required",
    published: false,
  });

  /* Beta's lesson. Same tutor on the row, but no assignment behind it — the
     shape you get when an admin schedules before assigning. */
  const othersLesson = await makeLesson({
    student_id: studentB,
    tutor_id: tutor,
    subject_id: physics,
    title: "Beta's physics lesson",
    status: "published",
    published: true,
    published_at: new Date().toISOString(),
  });

  const PRIVATE = "PRIVATE: parent is pushing too hard, go gently.";
  for (const lessonId of [published, unpublished]) {
    const { error } = await admin.from("lesson_notes").insert({
      lesson_id: lessonId,
      summary: "Quadratics.",
      tutor_private_notes: PRIVATE,
      tutor_reviewed: true,
    });
    if (error) throw new Error(`Could not create notes: ${error.message}`);
  }

  const alpha = await signIn(studentAUser);
  const beta = await signIn(studentBUser);
  const teacher = await signIn(tutorUser);

  /* -- the student ------------------------------------------------------- */

  console.log("As the student (Alpha)\n");

  {
    const { data } = await alpha.from("lessons").select("id, title");
    const ids = (data ?? []).map((l) => l.id);
    check(
      "sees their own published lesson",
      ids.includes(published),
      `${ids.length} lesson(s) visible`,
    );
    check(
      "cannot see another student's lesson in a list",
      !ids.includes(othersLesson),
      undefined,
    );
    check(
      "cannot see their own lesson before it is published",
      !ids.includes(unpublished),
      "status review_required, published false",
    );
  }

  {
    /* The one that matters most: a forbidden id and a nonexistent id must be
       indistinguishable. A permission error would confirm the row exists. */
    const forbidden = await alpha.from("lessons").select("id").eq("id", othersLesson);
    const nonexistent = await alpha.from("lessons").select("id").eq("id", randomUUID());
    check(
      "another student's lesson URL is not found, not forbidden",
      forbidden.error === null && (forbidden.data ?? []).length === 0,
      forbidden.error ? `got an error: ${forbidden.error.message}` : "empty result",
    );
    check(
      "a forbidden id is indistinguishable from a nonexistent one",
      JSON.stringify(forbidden.data) === JSON.stringify(nonexistent.data) &&
        (forbidden.error?.code ?? null) === (nonexistent.error?.code ?? null),
      undefined,
    );
  }

  {
    const { data, error } = await alpha.from("lesson_notes").select("*");
    check(
      "cannot read the lesson_notes table at all",
      (data ?? []).length === 0,
      error ? `error: ${error.message}` : "0 rows",
    );
  }

  {
    const { data } = await alpha.from("student_lesson_notes").select("*");
    const rows = data ?? [];
    const lessonIds = rows.map((r) => r.lesson_id);
    check(
      "reads notes for the published lesson through the student view",
      lessonIds.includes(published),
      `${rows.length} row(s)`,
    );
    check(
      "the unpublished lesson's notes are absent from that view",
      !lessonIds.includes(unpublished),
      undefined,
    );
    const leaked = rows.some((r) =>
      Object.values(r).some((v) => typeof v === "string" && v.includes("PRIVATE:")),
    );
    check(
      "tutor_private_notes never appears in the student projection",
      !leaked && !("tutor_private_notes" in (rows[0] ?? {})),
      rows[0] ? `columns: ${Object.keys(rows[0]).length}` : undefined,
    );
  }

  {
    const { data } = await alpha.from("students").select("id");
    const ids = (data ?? []).map((s) => s.id);
    check(
      "sees only their own student record",
      ids.length === 1 && ids[0] === studentA,
      `${ids.length} row(s)`,
    );
  }

  {
    const { error } = await alpha
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", studentAUser.id);
    const { data: after } = await admin
      .from("profiles")
      .select("role")
      .eq("id", studentAUser.id)
      .single();
    check(
      "cannot promote themselves to admin",
      after?.role === "student",
      error ? `rejected: ${error.code}` : `role is still ${after?.role}`,
    );
  }

  /* -- the other student -------------------------------------------------- */

  console.log("\nAs a different student (Beta)\n");

  {
    const { data, error } = await beta.from("lessons").select("id").eq("id", published);
    check(
      "cannot open Alpha's lesson by id",
      error === null && (data ?? []).length === 0,
      error ? `got an error: ${error.message}` : "empty result",
    );
  }

  {
    const { data } = await beta.from("student_lesson_notes").select("lesson_id");
    check(
      "cannot read Alpha's notes through the student view",
      !(data ?? []).map((r) => r.lesson_id).includes(published),
      `${(data ?? []).length} row(s) visible`,
    );
  }

  /* -- the tutor ---------------------------------------------------------- */

  console.log("\nAs the tutor\n");

  {
    const { data } = await teacher.from("students").select("id");
    const ids = (data ?? []).map((s) => s.id);
    check("sees the student they are assigned to", ids.includes(studentA), `${ids.length} row(s)`);
    check("cannot see a student they are not assigned to", !ids.includes(studentB), undefined);
  }

  {
    const { data } = await teacher.from("lessons").select("id");
    const ids = (data ?? []).map((l) => l.id);
    check(
      "sees both of their assigned student's lessons, published or not",
      ids.includes(published) && ids.includes(unpublished),
      `${ids.length} lesson(s)`,
    );
    check(
      "cannot see a lesson for an unassigned student, even with their own tutor_id on it",
      !ids.includes(othersLesson),
      undefined,
    );
  }

  {
    const { data } = await teacher.from("lesson_notes").select("lesson_id, tutor_private_notes");
    const mine = (data ?? []).filter((n) => n.lesson_id === published);
    check(
      "reads their own private notes",
      mine.length === 1 && mine[0].tutor_private_notes === PRIVATE,
      `${(data ?? []).length} row(s)`,
    );
  }

  {
    const { data } = await teacher
      .from("lessons")
      .update({ title: "Should not happen" })
      .eq("id", othersLesson)
      .select("id");
    const { data: after } = await admin
      .from("lessons")
      .select("title")
      .eq("id", othersLesson)
      .single();
    check(
      "cannot edit an unassigned student's lesson",
      (data ?? []).length === 0 && after?.title === "Beta's physics lesson",
      `title is still "${after?.title}"`,
    );
  }

  {
    /* The subject is the narrower gate: assigned in maths must not mean
       assigned in physics. */
    const { data, error } = await teacher
      .from("lessons")
      .insert({
        student_id: studentA,
        tutor_id: tutor,
        subject_id: physics,
        scheduled_at: new Date().toISOString(),
        title: "Physics lesson the tutor is not assigned for",
      })
      .select("id");
    if (data?.[0]?.id) created.lessons.push(data[0].id);
    check(
      "cannot schedule a lesson in a subject they are not assigned for",
      (data ?? []).length === 0,
      error ? `rejected: ${error.code}` : "the insert succeeded",
    );
  }

  /* -- signed out --------------------------------------------------------- */

  console.log("\nWith no session at all\n");

  {
    const stranger = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const table of ["lessons", "students", "profiles", "lesson_notes"]) {
      const { data } = await stranger.from(table).select("id");
      check(`anonymous read of ${table} returns nothing`, (data ?? []).length === 0, undefined);
    }
  }
}

/* -- run ------------------------------------------------------------------ */

let crashed = null;
try {
  await main();
} catch (error) {
  crashed = error;
} finally {
  process.stdout.write("\nCleaning up… ");
  try {
    await cleanup();
    console.log("done, nothing left behind.");
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    console.log(`Look for rows tagged ${TAG} and remove them by hand.`);
  }
}

if (crashed) {
  console.error(`\nThe check could not finish: ${crashed.message}\n`);
  process.exit(2);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} of ${checks.length} checks FAILED.`);
  console.log("Do not put real students in front of this until they pass.\n");
  process.exit(1);
}
console.log(`All ${checks.length} checks passed. The access rules hold in the real database.\n`);
