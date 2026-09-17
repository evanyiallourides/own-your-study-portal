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
  {
    email = "buyer@example.com",
    status = "paid",
    days = 365 as number | null,
    studentEmail = null as string | null,
  } = {},
): Promise<void> {
  await db.exec(`insert into public.orders
    (provider, sku_slug, sku_name, plan, currency, amount_total_minor, buyer_email,
     student_email, status, grants_question_bank_days)
    values ('stripe', '${slug}', '${slug}', 'full', 'usd', 12000, '${email}',
            ${studentEmail === null ? "null" : `'${studentEmail}'`},
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

describe("a parent buying for a child", () => {
  it("attaches the order to the student, not the payer", async () => {
    // buyer_email is the card holder. Matching a claim on the payer would mean
    // the child's own profile never finds the order that bought their lessons,
    // and the parent would silently collect the entitlement instead.
    await payFor("question-bank", {
      email: "a.parent@example.com",
      studentEmail: "Buyer@Example.com", // the child, cased differently
    });

    const claimed = await claim();
    assert.ok(claimed >= 1, "the student's own profile should find it");

    const { who } = await one<{ who: string }>(
      `select coalesce(student_email, buyer_email) as who
         from public.orders where buyer_email = 'a.parent@example.com'`,
    );
    assert.match(who, /buyer@example\.com/i, "claimed on the student's address");
  });

  it("does not let the payer claim it", async () => {
    // The parent has no student record here, and the order is not theirs to
    // take even if they did.
    await db.exec(`
      insert into auth.users (id, email) values
        ('33333333-3333-3333-3333-333333333333', 'a.parent@example.com') on conflict do nothing;
      insert into public.profiles (id, email, first_name, last_name, role)
        values ('33333333-3333-3333-3333-333333333333', 'a.parent@example.com', 'A', 'Parent', 'parent')
        on conflict (id) do nothing;
    `);
    await payFor("question-bank", {
      email: "a.parent@example.com",
      studentEmail: "someone.else@example.com",
    });
    const { n } = await one<{ n: number }>(
      `select public.claim_orders_for_profile('33333333-3333-3333-3333-333333333333') as n`,
    );
    assert.equal(Number(n), 0, "a parent must not collect their child's entitlement");
  });
});

/* ==========================================================================
   link_parent_for_profile
   --------------------------------------------------------------------------
   A purchase creates two accounts and they are accepted independently — the
   parent may click their invitation days before the child, or days after. So
   the link cannot be made at the moment of payment; it has to be made by
   whichever of the two arrives second, which means the same function has to
   work from either side.

   The other half of what is tested here is the refusals. A link grants a
   standing view of a child's lessons, homework and progress, so an order that
   did not clearly assert a parental relationship must never produce one.
   ========================================================================== */

describe("link_parent_for_profile", () => {
  /* Accepting an invitation, as Supabase performs it: a row in auth.users
     carrying the role the invitation was addressed with. Everything else —
     the profile, the parents or students row, the claim and the link — is
     handle_new_user() doing its job, which is the path worth testing. */
  async function accept(id: string, email: string, role: "parent" | "student"): Promise<void> {
    await db.exec(`
      insert into auth.users (id, email, raw_user_meta_data)
      values ('${id}', '${email}', '{"role":"${role}"}'::jsonb)
      on conflict do nothing;
    `);
  }

  async function makeParent(id: string, email: string): Promise<string> {
    await accept(id, email, "parent");
    return (await one<{ id: string }>(
      `select id from public.parents where profile_id = '${id}'`,
    )).id;
  }

  async function makeStudent(id: string, email: string): Promise<string> {
    await accept(id, email, "student");
    return (await one<{ id: string }>(
      `select id from public.students where profile_id = '${id}'`,
    )).id;
  }

  async function guardianOrder(
    buyerEmail: string,
    studentEmail: string,
    isGuardian: boolean | null,
  ): Promise<void> {
    await db.exec(`insert into public.orders
      (provider, sku_slug, sku_name, plan, currency, amount_total_minor,
       buyer_email, student_email, buyer_is_guardian, status)
      values ('stripe', 'committed-20hr', 'Committed Pack', 'full', 'usd', 114000,
              '${buyerEmail}', '${studentEmail}',
              ${isGuardian === null ? "null" : isGuardian}, 'paid')`);
  }

  async function link(profileId: string): Promise<number> {
    const { n } = await one<{ n: number }>(
      `select public.link_parent_for_profile('${profileId}') as n`,
    );
    return Number(n);
  }

  async function linkCount(parentId: string, studentId2: string): Promise<number> {
    const { n } = await one<{ n: number }>(
      `select count(*)::int as n from public.parent_students
        where parent_id = '${parentId}' and student_id = '${studentId2}'`,
    );
    return Number(n);
  }

  const P1 = "aaaaaaa1-0000-0000-0000-000000000001";
  const S1 = "aaaaaaa1-0000-0000-0000-000000000002";
  const P2 = "aaaaaaa2-0000-0000-0000-000000000001";
  const S2 = "aaaaaaa2-0000-0000-0000-000000000002";

  it("links when the parent accepts after the child", async () => {
    const studentRow = await makeStudent(S1, "child1@example.com");
    await guardianOrder("parent1@example.com", "child1@example.com", true);

    // No explicit call: accepting the invitation is what runs it.
    const parentRow = await makeParent(P1, "parent1@example.com");
    assert.equal(await linkCount(parentRow, studentRow), 1);
  });

  it("links when the child accepts after the parent", async () => {
    // The reverse order, which is the one a hand-written trigger usually
    // forgets: at the moment the parent accepted there was no child to link to,
    // so the work has to happen again from the other side.
    const parentRow = await makeParent(P2, "parent2@example.com");
    await guardianOrder("parent2@example.com", "child2@example.com", true);

    const studentRow = await makeStudent(S2, "child2@example.com");
    assert.equal(await linkCount(parentRow, studentRow), 1);
  });

  it("is safe to run again, so a redelivered webhook cannot double-link", async () => {
    const parentRow = (await one<{ id: string }>(
      `select id from public.parents where profile_id = '${P1}'`,
    )).id;
    const studentRow = (await one<{ id: string }>(
      `select id from public.students where profile_id = '${S1}'`,
    )).id;

    assert.equal(await link(P1), 0, "nothing new to link");
    assert.equal(await link(S1), 0, "nor from the other side");
    assert.equal(await linkCount(parentRow, studentRow), 1, "still exactly one row");
  });

  it("matches the addresses regardless of case", async () => {
    const studentRow = await makeStudent(
      "aaaaaaa3-0000-0000-0000-000000000002",
      "child3@example.com",
    );
    await guardianOrder("PARENT3@Example.com", "Child3@EXAMPLE.com", true);
    const parentRow = await makeParent(
      "aaaaaaa3-0000-0000-0000-000000000001",
      "parent3@example.com",
    );
    assert.equal(await linkCount(parentRow, studentRow), 1);
  });

  it("links a parent to each of the children they bought for", async () => {
    const first = await makeStudent("aaaaaaa4-0000-0000-0000-000000000002", "child4a@example.com");
    const second = await makeStudent("aaaaaaa4-0000-0000-0000-000000000003", "child4b@example.com");
    await guardianOrder("parent4@example.com", "child4a@example.com", true);
    await guardianOrder("parent4@example.com", "child4b@example.com", true);

    const parentRow = await makeParent(
      "aaaaaaa4-0000-0000-0000-000000000001",
      "parent4@example.com",
    );
    assert.equal(await linkCount(parentRow, first), 1);
    assert.equal(await linkCount(parentRow, second), 1);
  });

  it("links nobody when the buyer said they were not the parent", async () => {
    // Somebody paying for an adult friend's tuition. They bought the lessons;
    // they did not buy a view of how the lessons are going.
    const parentRow = await makeParent(
      "aaaaaaa5-0000-0000-0000-000000000001",
      "payer5@example.com",
    );
    const studentRow = await makeStudent(
      "aaaaaaa5-0000-0000-0000-000000000002",
      "friend5@example.com",
    );
    await guardianOrder("payer5@example.com", "friend5@example.com", false);

    assert.equal(await link("aaaaaaa5-0000-0000-0000-000000000001"), 0);
    assert.equal(await linkCount(parentRow, studentRow), 0);
  });

  it("links nobody for an order taken before the question existed", async () => {
    // buyer_is_guardian is null on every order that predates this migration.
    // Null is not a yes, and back-filling it as one would grant access to
    // families who were never asked.
    const parentRow = await makeParent(
      "aaaaaaa6-0000-0000-0000-000000000001",
      "payer6@example.com",
    );
    const studentRow = await makeStudent(
      "aaaaaaa6-0000-0000-0000-000000000002",
      "child6@example.com",
    );
    await guardianOrder("payer6@example.com", "child6@example.com", null);

    assert.equal(await link("aaaaaaa6-0000-0000-0000-000000000001"), 0);
    assert.equal(await linkCount(parentRow, studentRow), 0);
  });

  it("never links somebody to themselves", async () => {
    // A buyer who ticked the box and then typed their own address. Without the
    // guard this writes a real access grant from a person to themselves.
    await makeParent("aaaaaaa7-0000-0000-0000-000000000001", "self7@example.com");
    await guardianOrder("self7@example.com", "self7@example.com", true);
    assert.equal(await link("aaaaaaa7-0000-0000-0000-000000000001"), 0);
  });

  it("does nothing for a tutor, whoever paid for what", async () => {
    await db.exec(`
      insert into auth.users (id, email)
        values ('aaaaaaa8-0000-0000-0000-000000000001', 'tutor8@example.com') on conflict do nothing;
      insert into public.profiles (id, email, first_name, last_name, role)
        values ('aaaaaaa8-0000-0000-0000-000000000001', 'tutor8@example.com', 'A', 'Tutor', 'tutor')
        on conflict (id) do nothing;
    `);
    await guardianOrder("tutor8@example.com", "child1@example.com", true);
    assert.equal(await link("aaaaaaa8-0000-0000-0000-000000000001"), 0);
  });
});

/* ==========================================================================
   IA review credits
   --------------------------------------------------------------------------
   A ledger rather than a balance column, and the rules that makes possible are
   all money rules: a webhook delivered twice must not double somebody's
   credits, two browser tabs must not spend one credit twice, and a refund must
   take back what was not used without clawing back a review already read.

   Its own student, so nothing here depends on what the blocks above left
   behind — these run sequentially against one database, and a test that only
   passes in position is worse than no test.
   ========================================================================== */
describe("IA review credits", () => {
  const PERSON = "44444444-4444-4444-4444-444444444444";
  let iaStudentId: string;

  before(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${PERSON}', 'ia@example.com')
        on conflict (id) do nothing;
      insert into public.profiles (id, email, first_name, last_name, role)
        values ('${PERSON}', 'ia@example.com', 'Ira', 'Assess', 'student')
        on conflict (id) do nothing;
      insert into public.students (profile_id) values ('${PERSON}') on conflict do nothing;
    `);
    iaStudentId = (await one<{ id: string }>(
      `select id from public.students where profile_id = '${PERSON}'`,
    )).id;
  });

  const balance = async (): Promise<number> =>
    Number(
      (await one<{ n: number }>(`select public.ia_credit_balance('${iaStudentId}') as n`)).n,
    );

  /** An IA-review order for this person, optionally more than one. */
  async function buyReviews(quantity = 1, status = "paid"): Promise<string> {
    const { id } = await one<{ id: string }>(`
      insert into public.orders
        (provider, sku_slug, sku_name, plan, quantity, currency, amount_total_minor,
         buyer_email, status, grants_ia_markings)
      values ('stripe', 'ia-marking', 'IA Review', 'full', ${quantity}, 'usd',
              ${4500 * quantity}, 'ia@example.com', '${status}', 1)
      returning id`);
    return id;
  }

  const claimIa = async (): Promise<number> =>
    Number(
      (await one<{ n: number }>(`select public.claim_orders_for_profile('${PERSON}') as n`)).n,
    );

  it("starts at nothing", async () => {
    assert.equal(await balance(), 0);
  });

  it("credits one review per unit bought", async () => {
    // Three sciences means three IAs. Buying three and receiving one is the
    // bug this multiplication exists to prevent.
    await buyReviews(3);
    await claimIa();
    assert.equal(await balance(), 3);
  });

  it("does not credit the same order twice", async () => {
    // Webhook deliveries repeat as a matter of course, and claiming is called
    // on every sign-in. Both must be safe to run again.
    await claimIa();
    await claimIa();
    assert.equal(await balance(), 3, "re-claiming must not top the balance up again");
  });

  it("does not credit an order that has not settled", async () => {
    // Authorisation is not payment. A direct debit is authorised days before
    // the money arrives, and can still fail afterwards.
    await buyReviews(2, "authorised");
    await claimIa();
    assert.equal(await balance(), 3);
  });

  it("spends one credit at a time", async () => {
    const left = await one<{ n: number }>(
      `select public.spend_ia_credit('${iaStudentId}', 'Biology HL') as n`,
    );
    assert.equal(Number(left.n), 2);
    assert.equal(await balance(), 2);
  });

  it("refuses to spend what is not there", async () => {
    await db.exec(`select public.spend_ia_credit('${iaStudentId}', 'two')`);
    await db.exec(`select public.spend_ia_credit('${iaStudentId}', 'three')`);
    assert.equal(await balance(), 0);

    await assert.rejects(
      () => db.query(`select public.spend_ia_credit('${iaStudentId}', 'four')`),
      /No IA review credit available/,
      "a zero balance must refuse rather than go negative",
    );
    assert.equal(await balance(), 0);
  });

  it("takes back unused credits on a refund", async () => {
    const orderId = await buyReviews(2);
    await claimIa();
    assert.equal(await balance(), 2);

    const { n } = await one<{ n: number }>(
      `select public.revoke_ia_credits_for_order('${orderId}') as n`,
    );
    assert.equal(Number(n), 2);
    assert.equal(await balance(), 0);
  });

  it("does not claw back a review the student has already read", async () => {
    const orderId = await buyReviews(2);
    await claimIa();
    await db.exec(`select public.spend_ia_credit('${iaStudentId}', 'used one')`);
    assert.equal(await balance(), 1);

    const { n } = await one<{ n: number }>(
      `select public.revoke_ia_credits_for_order('${orderId}') as n`,
    );
    // One back, not two. The work was done and the student has read it.
    assert.equal(Number(n), 1);
    assert.equal(await balance(), 0);
  });

  it("never takes a balance negative on a refund", async () => {
    const orderId = await buyReviews(1);
    await claimIa();
    await db.exec(`select public.spend_ia_credit('${iaStudentId}', 'used it')`);
    assert.equal(await balance(), 0);

    const { n } = await one<{ n: number }>(
      `select public.revoke_ia_credits_for_order('${orderId}') as n`,
    );
    assert.equal(Number(n), 0, "a debt is not something we agreed to extend");
    assert.equal(await balance(), 0);
  });

  it("does not reverse the same refund twice", async () => {
    const orderId = await buyReviews(2);
    await claimIa();
    await one(`select public.revoke_ia_credits_for_order('${orderId}') as n`);

    await buyReviews(1);
    await claimIa();
    const before = await balance();

    const { n } = await one<{ n: number }>(
      `select public.revoke_ia_credits_for_order('${orderId}') as n`,
    );
    assert.equal(Number(n), 0);
    assert.equal(
      await balance(),
      before,
      "a second reversal must not take credits bought with another order",
    );
  });

  it("refuses a review with a total when no marking happened", async () => {
    /* The database's half of the rule the TypeScript also enforces. A mark out
       of 24 on work nobody had the descriptors for is the single output this
       whole subsystem exists to prevent, so it is refused in two places. */
    const { id: submissionId } = await one<{ id: string }>(`
      insert into public.ia_submissions
        (student_id, subject, level, session_month, session_year, stage,
         storage_path, file_name, file_size, file_hash)
      values ('${iaStudentId}', 'biology', 'HL', 'May', 2026, 'final',
              'ia/x/y.pdf', 'y.pdf', 1024, 'abc')
      returning id`);

    await assert.rejects(
      () =>
        db.query(`insert into public.ia_reviews
          (submission_id, rubric_id, prompt_version, model_id, mode, total, max_total, body)
          values ('${submissionId}', 'biology_fa2025', 'v1', 'gpt-4.1',
                  'feedback_only', 18, 24, '{}'::jsonb)`),
      /ia_reviews_no_total_without_marking/,
    );

    // The same row without a total is fine, which is what feedback mode writes.
    await db.exec(`insert into public.ia_reviews
      (submission_id, rubric_id, prompt_version, model_id, mode, total, max_total, body)
      values ('${submissionId}', 'biology_fa2025', 'v1', 'gpt-4.1',
              'feedback_only', null, 24, '{}'::jsonb)`);
  });

  it("refuses to call a review calibrated", async () => {
    // Nothing here has been measured against real reference marks. Changing
    // that string should require changing this constraint on purpose.
    const { id: submissionId } = await one<{ id: string }>(`
      insert into public.ia_submissions
        (student_id, subject, level, session_month, session_year, stage,
         storage_path, file_name, file_size, file_hash)
      values ('${iaStudentId}', 'chemistry', 'SL', 'May', 2026, 'final',
              'ia/z/z.pdf', 'z.pdf', 1024, 'def')
      returning id`);

    await assert.rejects(
      () =>
        db.query(`insert into public.ia_reviews
          (submission_id, rubric_id, prompt_version, model_id, mode,
           calibration_status, max_total, body)
          values ('${submissionId}', 'chemistry_fa2025', 'v1', 'gpt-4.1',
                  'marking', 'validated', 24, '{}'::jsonb)`),
      /calibration_status/,
    );
  });

  it("keeps the descriptors away from everybody but administrators", async () => {
    // Licensed text. A student reading it through the API is how it ends up
    // somewhere it should not be, so there is no student or tutor policy at
    // all — not a narrower one.
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'ia_assessment_packs'`,
    );
    assert.deepEqual(
      policies.rows.map((r) => r.policyname),
      ["ia_assessment_packs: admin all"],
    );
  });
});
