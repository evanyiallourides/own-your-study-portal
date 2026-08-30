#!/usr/bin/env node
/* ==========================================================================
   Provision the team
   --------------------------------------------------------------------------
   Creates the practice's staff accounts in Supabase from scripts/team.json.

   Every person gets a Supabase invitation, which is a real email to a real
   address. So the script does nothing by default: it prints what it would do
   and stops. `--send` is what actually invites people, and it is deliberately
   a separate, typed decision rather than a flag you might leave on.

   Idempotent. Anyone who already has an account is reported and skipped
   rather than re-invited, so it is safe to run again after adding one person
   to the roster.

   Usage
     node scripts/provision-team.mjs            # dry run — shows the plan
     node scripts/provision-team.mjs --send     # sends the invitations
     node scripts/provision-team.mjs --send --only=evangelos@…   # one person

   Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
   environment, or in .env.local beside them.
   ========================================================================== */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/* -- environment ---------------------------------------------------------- */

/* .env.local is read by hand rather than with a dependency: this script runs
   once or twice in the life of the practice and is not worth a package. */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "Put them in portal/.env.local, or export them before running.\n",
  );
  process.exit(1);
}

/* -- roster --------------------------------------------------------------- */

const rosterPath = path.join(here, "team.json");
if (!existsSync(rosterPath)) {
  console.error(
    "\nscripts/team.json not found.\n" +
      "Copy scripts/team.example.json to scripts/team.json and fill in the\n" +
      "real email addresses first.\n",
  );
  process.exit(1);
}

const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
const people = Array.isArray(roster.people) ? roster.people : [];

const args = process.argv.slice(2);
const send = args.includes("--send");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const ROLES = new Set(["admin", "tutor", "student", "parent"]);

/* Refuse the whole run rather than half of it. A roster with one bad row is
   a typo to fix, not a reason to invite five people and fail on the sixth. */
const problems = [];
for (const [index, person] of people.entries()) {
  const where = `people[${index}] (${person.firstName ?? "?"} ${person.lastName ?? "?"})`;
  if (!person.firstName || !person.lastName) problems.push(`${where}: needs a first and last name`);
  if (!person.email) problems.push(`${where}: no email address — fill it in`);
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email)) {
    problems.push(`${where}: "${person.email}" does not look like an email address`);
  }
  if (!ROLES.has(person.role)) problems.push(`${where}: role must be one of ${[...ROLES].join(", ")}`);
}

const duplicates = people
  .map((p) => p.email?.toLowerCase())
  .filter((e, i, all) => e && all.indexOf(e) !== i);
for (const email of new Set(duplicates)) problems.push(`${email} appears more than once`);

if (problems.length > 0) {
  console.error("\nThe roster is not ready:\n");
  for (const problem of problems) console.error("  ·", problem);
  console.error("");
  process.exit(1);
}

const selected = only ? people.filter((p) => p.email.toLowerCase() === only.toLowerCase()) : people;
if (selected.length === 0) {
  console.error(`\nNobody in the roster matches --only=${only}\n`);
  process.exit(1);
}

/* -- go ------------------------------------------------------------------- */

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Everyone already in auth, so an existing account is skipped rather than
 *  re-invited. Paged, because listUsers caps a page at 1000. */
async function existingByEmail() {
  const found = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list existing users: ${error.message}`);
    for (const user of data.users) if (user.email) found.set(user.email.toLowerCase(), user);
    if (data.users.length < 1000) return found;
  }
}

/** An admin who teaches needs a tutor record as well as their profile — the
 *  trigger only creates the row matching their role, and it is the tutor row
 *  that makes somebody assignable to a lesson. */
async function ensureTutorRecord(profileId, headline) {
  const { data: already } = await admin
    .from("tutors")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (already) return "already had one";

  const { error } = await admin
    .from("tutors")
    .insert({ profile_id: profileId, headline: headline || null });
  if (error) throw new Error(`Could not create the tutor record: ${error.message}`);
  return "created";
}

const label = (p) => `${p.firstName} ${p.lastName} <${p.email}>`;

async function main() {
  const existing = await existingByEmail();

  console.log(`\nSupabase   ${SUPABASE_URL}`);
  console.log(`Invites to ${APP_URL}/auth/callback`);
  console.log(send ? "Mode       SENDING INVITATIONS\n" : "Mode       dry run — nothing will be sent\n");

  let sent = 0;
  let skipped = 0;

  for (const person of selected) {
    const known = existing.get(person.email.toLowerCase());
    const teaches = person.role === "admin" && person.teaches === true;
    const summary = `${person.role}${teaches ? " + teaches" : ""}`;

    if (known) {
      console.log(`  skip   ${label(person)} — already has an account (${summary})`);
      skipped += 1;
      if (send && teaches) {
        const outcome = await ensureTutorRecord(known.id, person.headline);
        console.log(`         tutor record: ${outcome}`);
      }
      continue;
    }

    if (!send) {
      console.log(`  invite ${label(person)} — ${summary}`);
      continue;
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(person.email, {
      redirectTo: `${APP_URL}/auth/callback`,
      data: {
        role: person.role,
        first_name: person.firstName,
        last_name: person.lastName,
      },
    });

    if (error) {
      console.error(`  FAIL   ${label(person)} — ${error.message}`);
      continue;
    }

    console.log(`  sent   ${label(person)} — ${summary}`);
    sent += 1;

    if (teaches && data?.user?.id) {
      const outcome = await ensureTutorRecord(data.user.id, person.headline);
      console.log(`         tutor record: ${outcome}`);
    }
  }

  console.log("");
  if (send) {
    console.log(`${sent} invited, ${skipped} already had accounts.`);
    console.log("They each get an email with a one-time link. It expires — resend from");
    console.log("Admin → Tutors if anyone leaves it too long.\n");
  } else {
    console.log(`${selected.length - skipped} would be invited, ${skipped} already exist.`);
    console.log("Re-run with --send when the addresses above are right.\n");
  }
}

main().catch((error) => {
  console.error("\n", error.message, "\n");
  process.exit(1);
});
