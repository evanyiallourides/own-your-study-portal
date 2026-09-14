import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/* ==========================================================================
   The migrations, against a real Postgres
   --------------------------------------------------------------------------
   Everything else in this directory tests the demo repository, which restates
   the rules in TypeScript. That leaves the SQL itself — where those rules
   actually live — checked by nobody until it reaches a database, and
   `claim_orders_for_profile` decides who may read 2,868 paid questions.

   PGlite is Postgres compiled to WebAssembly, so this runs the real migrations
   through a real planner with no Docker and no server. What it cannot do is
   test RLS as Supabase applies it: these run as the owner, so the policies are
   asserted to exist and to be shaped correctly, not enforced. That still needs
   `supabase db reset` and a human.

   Supabase supplies the auth and storage schemas. They are stubbed only far
   enough for our migrations to execute — the point is to exercise our DDL, not
   to reimplement Supabase.
   ========================================================================== */

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations",
);

const SUPABASE_STUB = `
create schema if not exists auth;
create schema if not exists storage;
create extension if not exists pgcrypto;

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
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
  bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb
);
`;

const BUYER = "11111111-1111-1111-1111-111111111111";

let db: PGlite;
let studentId: string;

async function one<T = Record<string, unknown>>(sql: string): Promise<T> {
  const result = await db.query<T>(sql);
  const row = result.rows[0];
  assert.ok(row, `query returned no rows: ${sql.slice(0, 60)}`);
  return row;
}

/** Claim, returning how many orders were attached. */
async function claim(): Promise<number> {
  const { n } = await one<{ n: number }>(
    `select public.claim_orders_for_profile('${BUYER}') as n`,
  );
  return Number(n);
}

async function payFor(
  slug: string,
  { email = "buyer@example.com", status = "paid", days = 365 as number | null } = {},
): Promise<void> {
  await db.exec(`insert into public.orders
    (provider, sku_slug, sku_name, plan, currency, amount_total_minor, buyer_email,
     status, grants_question_bank_days)
    values ('stripe', '${slug}', '${slug}', 'full', 'usd', 12000, '${email}',
            '${status}', ${days === null ? "null" : days})`);
}

/** Days from now until the entitlement lapses. */
async function expiresInDays(): Promise<number> {
  const row = await one<{ days: number }>(
    `select (expires_at::date - now()::date) as days
       from public.question_bank_access where student_id = '${studentId}'`,
  );
  return Number(row.days);
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${BUYER}', 'Buyer@Example.com');
    insert into public.profiles (id, email, first_name, last_name, role)
      values ('${BUYER}', 'Buyer@Example.com', 'Bea', 'Buyer', 'student')
      on conflict (id) do nothing;
    insert into public.students (profile_id) values ('${BUYER}') on conflict do nothing;
  `);
  studentId = (await one<{ id: string }>(
    `select id from public.students where profile_id = '${BUYER}'`,
  )).id;
});

describe("the migrations", () => {
  it("apply in order against a real Postgres", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('orders','order_payments','customers')
        order by table_name`,
    );
    assert.deepEqual(tables.rows.map((r) => r.table_name), [
      "customers",
      "order_payments",
      "orders",
    ]);
  });

  it("keeps the unmatched-payments queue as an index, not a scan", async () => {
    // The admin screen's only actionable section is "money taken, nobody to
    // give it to". A partial index is what makes that question cheap.
    const { indexdef } = await one<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'orders_unmatched_idx'`,
    );
    assert.match(indexdef, /student_id IS NULL/i);
  });

  it("lets a student and a parent read orders, and a tutor read none", async () => {
    // Asserted, not enforced: these tests run as the owner. A tutor has no
    // business in a student's billing, and the absence of a policy is the
    // whole of that rule.
    const policies = await db.query<{ policyname: string; qual: string }>(
      `select policyname, coalesce(qual, '') as qual
         from pg_policies where tablename = 'orders' order by policyname`,
    );
    const names = policies.rows.map((r) => r.policyname);
    assert.deepEqual(names, [
      "orders: admin all",
      "orders: parent reads children",
      "orders: student reads own",
    ]);
    assert.equal(
      policies.rows.filter((r) => /tutor/i.test(r.qual)).length,
      0,
      "no policy on orders may mention tutors",
    );
  });

  it("names no provider in a column, so a second one needs no migration", async () => {
    // GoCardless is coming. Direct debit authorises now and settles days later,
    // so it cannot reuse Stripe's identifiers or Stripe's timing — but it can
    // reuse every one of these columns.
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('orders', 'customers', 'order_payments')
          and column_name like '%stripe%'`,
    );
    assert.deepEqual(columns.rows, [], "a provider name leaked into a column name");
  });

  it("keeps every anonymous buyer's email to administrators", async () => {
    const policies = await db.query(
      `select policyname from pg_policies where tablename = 'customers'`,
    );
    assert.equal(policies.rows.length, 1, "customers should have exactly the admin policy");
  });
});

describe("claim_orders_for_profile", () => {
  it("never claims an order that has not been paid", async () => {
    await payFor("question-bank", { status: "pending" });
    assert.equal(await claim(), 0);
    const access = await db.query(`select * from public.question_bank_access`);
    assert.equal(access.rows.length, 0, "a pending order granted access");
  });

  it("matches the buyer's email regardless of case", async () => {
    // Stripe returns whatever the buyer typed. Postgres = is case-sensitive.
    await payFor("question-bank", { email: "BUYER@EXAMPLE.COM" });
    assert.equal(await claim(), 1);
    const { granted, linked } = await one<{ granted: boolean; linked: boolean }>(
      `select granted, order_id is not null as linked
         from public.question_bank_access where student_id = '${studentId}'`,
    );
    assert.equal(granted, true);
    assert.equal(linked, true, "the access should record which order paid for it");
    assert.equal(await expiresInDays(), 365);
  });

  it("extends a renewal rather than resetting it", async () => {
    // Somebody who renews half way through keeps what they already paid for.
    // A naive upsert overwrites expires_at and quietly takes 180 days away.
    await db.exec(`update public.question_bank_access
      set expires_at = now() + interval '180 days' where student_id = '${studentId}'`);
    await payFor("question-bank");
    assert.equal(await claim(), 1);
    assert.equal(await expiresInDays(), 545, "180 remaining + 365 bought");
  });

  it("is safe to run twice, so a redelivered webhook cannot stack years on", async () => {
    assert.equal(await claim(), 0);
    assert.equal(await expiresInDays(), 545);
  });

  it("does not unlock the banks for a tutoring package", async () => {
    // Tutoring reaches the banks through pooled hours, in
    // has_question_bank_access(). A grant here as well would be a second
    // source of truth for one entitlement.
    await db.exec(`update public.question_bank_access
      set expires_at = now() - interval '1 day' where student_id = '${studentId}'`);
    await payFor("committed-20hr", { days: null });
    await claim();
    const { ok } = await one<{ ok: boolean }>(
      `select public.has_question_bank_access('${studentId}') as ok`,
    );
    assert.equal(ok, false);
  });

  it("leaves a payment from an unknown email in the admin queue", async () => {
    await payFor("question-bank", { email: "stranger@example.com" });
    const { n } = await one<{ n: number }>(
      `select count(*)::int as n from public.orders
        where student_id is null and status <> 'pending'`,
    );
    assert.equal(Number(n), 1);
  });
});

describe("transcript retention", () => {
  /** A lesson that ended `days` ago, with a transcript against it. */
  async function lessonWithTranscript(id: string, endedDaysAgo: number): Promise<void> {
    await db.exec(`
      insert into public.lessons (id, student_id, tutor_id, subject_id, scheduled_at, ended_at,
                                  duration_minutes, status)
      select '${id}', s.id, t.id, sub.id,
             now() - interval '${endedDaysAgo} days',
             now() - interval '${endedDaysAgo} days',
             60, 'published'
        from public.students s, public.tutors t, public.subjects sub
       limit 1;
      insert into public.transcripts (lesson_id, raw_transcript, speaker_segments_json, duration_seconds)
      values ('${id}', 'Tutor: and what did you get for part b?',
              '[{"speaker":"tutor","text":"and what did you get for part b?"}]'::jsonb, 3600);
    `);
  }

  async function transcript(id: string) {
    return one<{ raw: string | null; segments: unknown[]; purged: string | null; seconds: number }>(
      `select raw_transcript as raw, speaker_segments_json as segments,
              purged_at as purged, duration_seconds as seconds
         from public.transcripts where lesson_id = '${id}'`,
    );
  }

  before(async () => {
    // A tutor and a subject to hang lessons off; the students already exist.
    await db.exec(`
      insert into auth.users (id, email) values
        ('22222222-2222-2222-2222-222222222222', 'tutor@example.com')
        on conflict do nothing;
      insert into public.profiles (id, email, first_name, last_name, role)
        values ('22222222-2222-2222-2222-222222222222', 'tutor@example.com', 'Tam', 'Tutor', 'tutor')
        on conflict (id) do nothing;
      insert into public.tutors (profile_id) values ('22222222-2222-2222-2222-222222222222')
        on conflict do nothing;
      insert into public.subjects (name, curriculum) values ('Chemistry', 'IB')
        on conflict do nothing;
    `);
    await db.exec(`update public.app_settings set transcript_retention_days = 365`);
  });

  it("leaves a recent transcript alone", async () => {
    await lessonWithTranscript("aaaaaaaa-0000-4000-8000-000000000001", 30);
    await one(`select public.purge_expired_transcripts() as n`);
    const t = await transcript("aaaaaaaa-0000-4000-8000-000000000001");
    assert.ok(t.raw, "a 30-day-old transcript should still be readable");
    assert.equal(t.purged, null);
  });

  it("removes the verbatim content once it is past the window", async () => {
    await lessonWithTranscript("aaaaaaaa-0000-4000-8000-000000000002", 400);
    const { n } = await one<{ n: number }>(`select public.purge_expired_transcripts() as n`);
    assert.equal(Number(n), 1);

    const t = await transcript("aaaaaaaa-0000-4000-8000-000000000002");
    assert.equal(t.raw, null, "the words a child said should be gone");
    assert.deepEqual(t.segments, [], "and so should the speaker segments");
    assert.ok(t.purged, "with a record of when");
  });

  it("keeps the row, so the lesson still knows a transcript existed", async () => {
    const t = await transcript("aaaaaaaa-0000-4000-8000-000000000002");
    assert.equal(Number(t.seconds), 3600, "duration is not personal and is worth keeping");
  });

  it("does not touch the reviewed lesson notes", async () => {
    // The write-up is what a student studies from months later, and it has been
    // through a tutor. The transcript is the raw material. That difference is
    // the entire reason this is a retention window and not a delete button.
    await db.exec(`
      insert into public.lesson_notes (lesson_id, summary, tutor_reviewed)
      values ('aaaaaaaa-0000-4000-8000-000000000002', 'Covered equilibrium and Le Chatelier.', true)
      on conflict (lesson_id) do nothing;
    `);
    await one(`select public.purge_expired_transcripts() as n`);
    const notes = await one<{ summary: string }>(
      `select summary from public.lesson_notes
        where lesson_id = 'aaaaaaaa-0000-4000-8000-000000000002'`,
    );
    assert.match(notes.summary, /Le Chatelier/);
  });

  it("is idempotent, so running it twice purges nothing the second time", async () => {
    await lessonWithTranscript("aaaaaaaa-0000-4000-8000-000000000003", 400);
    const first = await one<{ n: number }>(`select public.purge_expired_transcripts() as n`);
    const second = await one<{ n: number }>(`select public.purge_expired_transcripts() as n`);
    assert.equal(Number(first.n), 1);
    assert.equal(Number(second.n), 0, "an already-purged row must not be worked on again");
  });

  it("keeps everything when retention is turned off", async () => {
    // A missing or zero setting has to mean keep, not delete. The wrong way
    // round on a destructive job is unrecoverable.
    await db.exec(`update public.app_settings set transcript_retention_days = 0`);
    await lessonWithTranscript("aaaaaaaa-0000-4000-8000-000000000004", 5000);
    const { n } = await one<{ n: number }>(`select public.purge_expired_transcripts() as n`);
    assert.equal(Number(n), 0);
    assert.ok((await transcript("aaaaaaaa-0000-4000-8000-000000000004")).raw);
    await db.exec(`update public.app_settings set transcript_retention_days = 365`);
  });

  it("measures age from the lesson, not from when the transcript was written", async () => {
    // A transcript that arrived late is still a record of a lesson that
    // happened when it happened.
    await lessonWithTranscript("aaaaaaaa-0000-4000-8000-000000000005", 400);
    await db.exec(`update public.transcripts set created_at = now()
                    where lesson_id = 'aaaaaaaa-0000-4000-8000-000000000005'`);
    await one(`select public.purge_expired_transcripts() as n`);
    const t = await transcript("aaaaaaaa-0000-4000-8000-000000000005");
    assert.equal(t.raw, null, "a brand-new row about an old lesson should still purge");
  });

  it("cannot be run by a signed-in user", async () => {
    const { ok } = await one<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'public.purge_expired_transcripts()', 'execute') as ok`,
    );
    assert.equal(ok, false, "a destructive job must not be callable from the client");
  });
});
