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
