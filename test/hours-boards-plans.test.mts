import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { CATALOGUE } from "@/lib/catalogue";
import { summariseTutoringHours, type TutoringHourEntry } from "@/lib/types";

/* ==========================================================================
   Tutoring hours, class boards and study plans, against a real Postgres
   --------------------------------------------------------------------------
   Its own database rather than a section of migrations.test.mts, so the
   fixtures here (a student with lessons, a tutor assigned to them) cannot
   change what the payments tests see.
   ========================================================================== */

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const HOURS_MIGRATION = readdirSync(MIGRATIONS).find((f) => f.endsWith("_hours_boards_plans.sql"))!;

const SUPABASE_STUB = `
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb
);
`;

const STUDENT = "55555555-5555-5555-5555-555555555555";
const TUTOR = "66666666-6666-6666-6666-666666666666";
const STRANGER = "77777777-7777-7777-7777-777777777777";

let db: PGlite;
let studentId: string;
let tutorId: string;
let subjectId: string;

async function one<T = Record<string, unknown>>(sql: string): Promise<T> {
  const row = (await db.query<T>(sql)).rows[0];
  assert.ok(row, `no rows: ${sql.slice(0, 60)}`);
  return row;
}

const n = async (sql: string): Promise<number> => Number((await one<{ n: number }>(sql)).n);

const purchased = () => n(`select public.tutoring_minutes_purchased('${studentId}') as n`);
const claim = () => n(`select public.claim_orders_for_profile('${STUDENT}') as n`);

async function buyHours(slug: string, hours: number, { quantity = 1, status = "paid" } = {}): Promise<string> {
  const { id } = await one<{ id: string }>(`
    insert into public.orders
      (provider, sku_slug, sku_name, plan, quantity, currency, amount_total_minor,
       buyer_email, status, grants_tutoring_hours)
    values ('stripe', '${slug}', '${slug}', 'full', ${quantity}, 'usd', 100,
            'hours@example.com', '${status}', ${hours})
    returning id`);
  return id;
}

async function lesson(daysFromNow: number, minutes: number, status = "scheduled"): Promise<void> {
  await db.exec(`
    insert into public.lessons (student_id, tutor_id, subject_id, scheduled_at, duration_minutes, status)
    values ('${studentId}', '${tutorId}', '${subjectId}', now() + interval '${daysFromNow} days',
            ${minutes}, '${status}')`);
}

async function as(profileId: string | null): Promise<void> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${profileId ?? ""}', false)`);
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${STUDENT}', 'hours@example.com'), ('${TUTOR}', 'tt@example.com'), ('${STRANGER}', 'x@example.com');
    insert into public.profiles (id, email, first_name, last_name, role) values
      ('${STUDENT}', 'hours@example.com', 'Hal', 'Hours', 'student'),
      ('${TUTOR}', 'tt@example.com', 'Tia', 'Tutor', 'tutor'),
      ('${STRANGER}', 'x@example.com', 'Xan', 'Stranger', 'student')
      on conflict (id) do nothing;
    insert into public.students (profile_id) values ('${STUDENT}'), ('${STRANGER}') on conflict do nothing;
    insert into public.tutors (profile_id) values ('${TUTOR}') on conflict do nothing;
    insert into public.subjects (name, curriculum) values ('Physics', 'IB');
  `);
  studentId = (await one<{ id: string }>(`select id from public.students where profile_id = '${STUDENT}'`)).id;
  tutorId = (await one<{ id: string }>(`select id from public.tutors where profile_id = '${TUTOR}'`)).id;
  subjectId = (await one<{ id: string }>(`select id from public.subjects where name = 'Physics'`)).id;
  await db.exec(`
    insert into public.tutor_student_subjects (tutor_id, student_id, subject_id)
    values ('${tutorId}', '${studentId}', '${subjectId}')`);
});

describe("tutoring hours", () => {
  it("credits nothing for an order that has not settled", async () => {
    await buyHours("starter-5hr", 5, { status: "pending" });
    await claim();
    assert.equal(await purchased(), 0);
  });

  it("credits a package's hours when it is claimed, times the quantity", async () => {
    await buyHours("single-session", 1, { quantity: 3 });
    await claim();
    assert.equal(await purchased(), 3 * 60);
  });

  it("does not credit the same order twice", async () => {
    const before = await purchased();
    await claim();
    await claim();
    assert.equal(await purchased(), before);
  });

  it("counts bought hours towards the question bank, without needing lessons booked", async () => {
    assert.equal(
      (await one<{ ok: boolean }>(`select public.has_question_bank_access('${studentId}') as ok`)).ok,
      false,
    );
    await buyHours("committed-20hr", 20);
    await claim();
    assert.equal(
      (await one<{ ok: boolean }>(`select public.has_question_bank_access('${studentId}') as ok`)).ok,
      true,
    );
  });

  it("does not double count a booked lesson as both bought and booked", async () => {
    // 23 hours bought; one 60-minute lesson booked from them.
    await lesson(3, 60);
    assert.equal(await n(`select public.student_pooled_minutes('${studentId}') as n`), 23 * 60);
  });

  it("reports used and booked minutes only to people entitled to see them", async () => {
    await lesson(-7, 90, "published");
    await lesson(-2, 30, "cancelled");

    await as(null);
    const anonymous = await one<{ used_minutes: number; booked_minutes: number }>(
      `select * from public.student_lesson_minutes('${studentId}')`,
    );
    assert.deepEqual([anonymous.used_minutes, anonymous.booked_minutes], [0, 0]);

    await as(STRANGER);
    const stranger = await one<{ used_minutes: number; booked_minutes: number }>(
      `select * from public.student_lesson_minutes('${studentId}')`,
    );
    assert.deepEqual([stranger.used_minutes, stranger.booked_minutes], [0, 0]);

    for (const who of [STUDENT, TUTOR]) {
      await as(who);
      const row = await one<{ used_minutes: number; booked_minutes: number }>(
        `select * from public.student_lesson_minutes('${studentId}')`,
      );
      assert.deepEqual([row.used_minutes, row.booked_minutes], [90, 60], `as ${who}`);
    }
    await as(null);
  });

  it("takes back only unbooked hours on a refund, and only once", async () => {
    // 23h bought, 150 minutes committed (90 taught + 60 booked) => 1230 free.
    const order = await buyHours("elite-60s", 120);
    await claim();
    const free = (await purchased()) - 150;

    const taken = await n(`select public.revoke_tutoring_hours_for_order('${order}') as n`);
    assert.equal(taken, Math.min(120 * 60, free));
    assert.equal(await n(`select public.revoke_tutoring_hours_for_order('${order}') as n`), 0);
  });

  it("never takes back hours that are already committed to lessons", async () => {
    // Book until only a sliver of what has been bought is still free.
    await lesson(10, 480);
    await lesson(11, 480);
    await lesson(12, 480);
    const order = await buyHours("starter-5hr", 5);
    await claim();

    const committed = await n(`select coalesce(sum(duration_minutes), 0) as n from public.lessons
                                where student_id = '${studentId}' and status <> 'cancelled'`);
    const before = await purchased();
    const free = before - committed;
    assert.ok(free > 0 && free < 5 * 60, `fixture should leave a partial balance, got ${free}`);

    const taken = await n(`select public.revoke_tutoring_hours_for_order('${order}') as n`);
    assert.equal(taken, free);
    assert.equal(await purchased(), committed);
  });

  it("is closed to signed-in users for revoking", async () => {
    const grants = await db.query<{ grantee: string }>(`
      select grantee from information_schema.routine_privileges
       where routine_name = 'revoke_tutoring_hours_for_order'`);
    const grantees = grants.rows.map((r) => r.grantee);
    assert.ok(!grantees.includes("authenticated"));
    assert.ok(!grantees.includes("anon"));
  });

  it("backfills every hourly package in the catalogue, with the catalogue's hours", () => {
    const sql = readFileSync(path.join(MIGRATIONS, HOURS_MIGRATION), "utf8");
    const backfill = new Map(
      [...sql.matchAll(/when '([a-z0-9-]+)'\s+then (\d+)/g)].map((m) => [m[1]!, Number(m[2])]),
    );
    const hourly = CATALOGUE.filter((sku) => sku.hours !== null);
    assert.equal(backfill.size, hourly.length, "a package with hours is missing from the backfill");
    for (const sku of hourly) assert.equal(backfill.get(sku.slug), sku.hours, sku.slug);
  });
});

describe("class boards", () => {
  it("accepts an https link", async () => {
    await db.exec(`insert into public.class_boards (student_id, label, url)
                   values ('${studentId}', 'Physics board', 'https://miro.com/app/board/abc/')`);
  });

  for (const url of ["http://miro.com/board", "javascript:alert(1)", "https://has space.com/x"]) {
    it(`refuses ${url}`, async () => {
      await assert.rejects(() =>
        db.query(`insert into public.class_boards (student_id, label, url)
                  values ('${studentId}', 'Bad', '${url.replace(/'/g, "''")}')`),
      );
    });
  }

  it("is behind row level security for every table added", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class
       where relname in ('tutoring_hour_entries', 'class_boards', 'study_plans')`);
    assert.equal(rows.rows.length, 3);
    for (const row of rows.rows) assert.ok(row.relrowsecurity, row.relname);
  });

  it("lets a tutor write boards and plans, and a student only read them", async () => {
    const policies = await db.query<{ tablename: string; policyname: string; cmd: string }>(`
      select tablename, policyname, cmd from pg_policies
       where tablename in ('class_boards', 'study_plans')`);
    for (const table of ["class_boards", "study_plans"]) {
      const mine = policies.rows.filter((p) => p.tablename === table);
      const student = mine.find((p) => p.policyname.includes("student"));
      const tutor = mine.find((p) => p.policyname.includes("tutor"));
      assert.equal(student?.cmd, "SELECT", `${table}: student policy`);
      assert.equal(tutor?.cmd, "ALL", `${table}: tutor policy`);
    }
  });
});

describe("study plans", () => {
  it("keeps one plan per student, updated in place", async () => {
    await db.exec(`insert into public.study_plans (student_id, review, goals)
                   values ('${studentId}', 'First', array['A'])`);
    await db.exec(`insert into public.study_plans (student_id, review, goals)
                   values ('${studentId}', 'Second', array['A','B'])
                   on conflict (student_id) do update set review = excluded.review, goals = excluded.goals`);
    const row = await one<{ review: string; goals: string[] }>(
      `select review, goals from public.study_plans where student_id = '${studentId}'`,
    );
    assert.equal(row.review, "Second");
    assert.deepEqual(row.goals, ["A", "B"]);
  });
});

describe("summariseTutoringHours", () => {
  const entry = (minutes: number): TutoringHourEntry => ({
    id: String(minutes),
    minutes,
    reason: minutes > 0 ? "purchase" : "refund",
    note: null,
    createdAt: new Date().toISOString(),
  });
  const now = new Date("2026-11-23T12:00:00Z");

  it("splits lessons into taught and booked, and skips cancelled ones", () => {
    const hours = summariseTutoringHours(
      [entry(600), entry(-60)],
      [
        { scheduledAt: "2026-11-20T10:00:00Z", durationMinutes: 60, status: "published" },
        { scheduledAt: "2026-11-21T10:00:00Z", durationMinutes: 90, status: "cancelled" },
        { scheduledAt: "2026-11-30T10:00:00Z", durationMinutes: 120, status: "scheduled" },
      ],
      now,
    );
    assert.deepEqual(
      [hours.purchasedMinutes, hours.usedMinutes, hours.bookedMinutes, hours.remainingMinutes],
      [540, 60, 120, 360],
    );
  });

  it("goes negative when more is booked than bought, rather than hiding it", () => {
    const hours = summariseTutoringHours(
      [entry(60)],
      [{ scheduledAt: "2026-11-30T10:00:00Z", durationMinutes: 120, status: "scheduled" }],
      now,
    );
    assert.equal(hours.remainingMinutes, -60);
  });
});
