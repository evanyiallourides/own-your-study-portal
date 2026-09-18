#!/usr/bin/env node
/* ==========================================================================
   Preflight
   --------------------------------------------------------------------------
   Answers one question: if I deploy right now, what will be broken?

   Read-only. It changes nothing, contacts nothing except Cloudflare and
   Supabase to ask what they already know, and is safe to run at any point.

   The value is in the order. A deploy that half-works is worse than one that
   does not start: the portal will happily come up in demo mode with no
   database, and the first person to notice will be a student looking at
   invented lessons on a real domain. So each check says what it means, not
   just whether it passed.

     npm run preflight
     npm run preflight -- --env staging

   Run through npm, not node: it reads the catalogue, which is TypeScript, and
   needs test/alias-hooks.mjs to resolve it.
   ========================================================================== */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const args = process.argv.slice(2);
const envName = args.find((a) => a.startsWith("--env="))?.slice("--env=".length)
  ?? (args.includes("--env") ? args[args.indexOf("--env") + 1] : null);

/* -- output --------------------------------------------------------------- */

const results = [];
const ok = (what, detail) => results.push({ level: "ok", what, detail });
const warn = (what, detail) => results.push({ level: "warn", what, detail });
const stop = (what, detail) => results.push({ level: "stop", what, detail });

const MARK = { ok: "  ok  ", warn: " note ", stop: " STOP " };

/* -- helpers -------------------------------------------------------------- */

function run(command, commandArgs) {
  try {
    return {
      ok: true,
      out: execFileSync(command, commandArgs, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

/* -- 1. the files that have to be there ----------------------------------- */

for (const file of ["wrangler.jsonc", "open-next.config.ts", "package.json"]) {
  if (existsSync(path.join(root, file))) ok(file, "present");
  else stop(file, "missing — the Worker cannot be built without it");
}

const wranglerRaw = existsSync(path.join(root, "wrangler.jsonc"))
  ? readFileSync(path.join(root, "wrangler.jsonc"), "utf8")
  : "";

/* Comments make it not-quite-JSON, and the fields worth checking are simple
   enough to read with a regex rather than pulling in a JSONC parser. */
const workerName = envName
  ? /"staging"\s*:\s*\{[^]*?"name"\s*:\s*"([^"]+)"/.exec(wranglerRaw)?.[1]
  : /^\s*"name"\s*:\s*"([^"]+)"/m.exec(wranglerRaw)?.[1];

if (workerName) ok("Worker name", workerName);
else stop("Worker name", "could not be read from wrangler.jsonc");

if (/"nodejs_compat"/.test(wranglerRaw)) {
  ok("nodejs_compat", "set — node:crypto will work");
} else {
  stop(
    "nodejs_compat",
    "not set. The Recall webhook and Google OAuth both need node:crypto; without it they fail at runtime",
  );
}

const appUrl = envName
  ? /"staging"\s*:\s*\{[^]*?"NEXT_PUBLIC_APP_URL"\s*:\s*"([^"]+)"/.exec(wranglerRaw)?.[1]
  : /"NEXT_PUBLIC_APP_URL"\s*:\s*"([^"]+)"/.exec(wranglerRaw)?.[1];
if (appUrl) ok("App URL", appUrl);
else warn("App URL", "NEXT_PUBLIC_APP_URL not found in wrangler.jsonc vars");

/* -- 2. cloudflare -------------------------------------------------------- */

const who = run("npx", ["wrangler", "whoami"]);
const authed = who.ok && !/not authenticated/i.test(who.out);

if (authed) {
  const account = /│\s*([^│]+?)\s*│\s*[0-9a-f]{32}/.exec(who.out)?.[1]?.trim();
  ok("Cloudflare login", account ? `signed in — ${account}` : "signed in");
} else {
  stop("Cloudflare login", "not signed in. Run: npx wrangler login");
}

/* -- 3. secrets ----------------------------------------------------------- */

/* The two that decide whether this is a real portal or a demo, and the ones
   that fail closed rather than loudly if they are absent. */
const REQUIRED = [
  ["NEXT_PUBLIC_SUPABASE_URL", "without it the portal serves invented demo data on a real domain"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "same — demo mode until both are set"],
  ["SUPABASE_SERVICE_ROLE_KEY", "invitations and the Recall webhook cannot run without it"],
];
const OPTIONAL = [
  ["RECALL_API_KEY", "no notetaker; lessons still work"],
  ["RECALL_WEBHOOK_SECRET", "the webhook refuses every request until this is set"],
  ["OPENAI_API_KEY", "no AI drafts; transcripts still stored, tutors write up by hand"],
  ["GOOGLE_CLIENT_ID", "Meet links must be pasted in by hand"],
  ["GOOGLE_CLIENT_SECRET", "as above"],
];

if (authed && workerName) {
  const listArgs = ["wrangler", "secret", "list"];
  if (envName) listArgs.push("--env", envName);
  const secrets = run("npx", listArgs);

  if (!secrets.ok) {
    warn(
      "Secrets",
      "could not be listed — usually means the Worker has not been deployed yet. Deploy once, then set them",
    );
  } else {
    const names = new Set([...secrets.out.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]));
    if (names.size === 0) {
      warn("Secrets", "none set yet — the portal will come up in demo mode");
    }
    for (const [name, consequence] of REQUIRED) {
      if (names.has(name)) ok(name, "set");
      else stop(name, `not set — ${consequence}`);
    }
    for (const [name, consequence] of OPTIONAL) {
      if (names.has(name)) ok(name, "set");
      else warn(name, `not set — ${consequence}`);
    }
  }
} else {
  warn("Secrets", "skipped — sign in to Cloudflare first");
}

/* -- 4. the build --------------------------------------------------------- */

const built = existsSync(path.join(root, ".open-next", "worker.js"));
if (built) ok("Worker bundle", ".open-next/worker.js exists — `npm run cf:deploy` rebuilds it anyway");
else warn("Worker bundle", "not built yet; `npm run cf:deploy` will build it");

/* -- 5. things that are easy to forget ------------------------------------ */

const local = { ...readEnvFile(path.join(root, ".env.local")), ...readEnvFile(path.join(root, ".env")) };
if (local.NEXT_PUBLIC_SUPABASE_URL) {
  ok("Local Supabase", "configured — migrations can be run from here");
} else {
  warn("Local Supabase", "no NEXT_PUBLIC_SUPABASE_URL locally; needed to run migrations or provision the team");
}

if (existsSync(path.join(here, "team.json"))) {
  const roster = JSON.parse(readFileSync(path.join(here, "team.json"), "utf8"));
  const missing = (roster.people ?? []).filter((p) => !p.email).length;
  if (missing === 0) ok("Team roster", `${(roster.people ?? []).length} people, all with addresses`);
  else warn("Team roster", `${missing} of ${roster.people.length} still have no email address`);
} else {
  warn("Team roster", "scripts/team.json not created yet — copy team.example.json when you are ready");
}

/* -- 6. can money actually reach the bank? -------------------------------- */

/* Taking a payment and being paid are two different switches, and Stripe will
   happily leave the second one off. Charges succeed, the balance climbs, and
   nothing says so anywhere in the portal — the only symptom is money that
   never arrives. So this section asks the two questions separately. */

const stripeKey = local.STRIPE_SECRET_KEY;

if (!stripeKey) {
  warn("Stripe", "no STRIPE_SECRET_KEY locally — skipping the payment checks");
} else {
  const mode = stripeKey.startsWith("sk_live_") ? "live" : "test";
  const api = async (endpoint) => {
    const response = await fetch(`https://api.stripe.com${endpoint}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    return { status: response.status, body: await response.json() };
  };

  const account = await api("/v1/account");
  if (account.body?.error) {
    stop("Stripe key", account.body.error.message);
  } else {
    const a = account.body;
    ok("Stripe account", `${a.id} · ${a.country} · ${mode} mode`);

    if (a.charges_enabled) ok("Taking payments", "enabled");
    else stop("Taking payments", "charges are disabled — every buy button will fail at Stripe");

    const balance = await api("/v1/balance");
    const held = [...(balance.body.available ?? []), ...(balance.body.pending ?? [])]
      .filter((b) => b.amount > 0)
      .map((b) => `${b.currency.toUpperCase()} ${(b.amount / 100).toFixed(2)}`)
      .join(", ");

    if (a.payouts_enabled) {
      const schedule = a.settings?.payouts?.schedule;
      ok(
        "Payouts",
        `enabled · ${schedule?.interval ?? "?"}, ${schedule?.delay_days ?? "?"} day delay`
          + (held ? ` · ${held} in the balance` : ""),
      );
    } else {
      /* Not a warning. The business is taking real money it cannot withdraw,
         and every further sale makes the number bigger. */
      stop(
        "Payouts",
        `DISABLED${held ? ` — ${held} sitting in Stripe with no way out` : ""}. `
          + "Usually a missing bank account: dashboard.stripe.com/settings/payouts",
      );
    }

    /* Money can be trapped one level deeper than "payouts are disabled": a
       balance accrues in a currency that has no bank account attached to it,
       so payouts keep running for every other currency and that one silently
       piles up. Stripe converts non-primary currencies into the primary one at
       2% unless the currency is configured for settlement, so the same check
       answers both "is this stranded" and "am I paying 2% to repatriate it".

       This deliberately does not try to list the attached bank accounts. The
       external_accounts endpoint refuses this key — the account is controlled
       by a platform application — so the honest signal is the one that can be
       read: a currency holding money that has never been paid out. */
    const byCurrency = new Map();
    for (const row of [...(balance.body.available ?? []), ...(balance.body.pending ?? [])]) {
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
    }

    const payouts = await api("/v1/payouts?limit=100");
    const paidOutIn = new Set((payouts.body.data ?? []).map((p) => p.currency));

    for (const [currency, minor] of byCurrency) {
      if (minor <= 0) continue;
      const amount = `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`;
      const primary = currency === a.default_currency;

      if (paidOutIn.has(currency)) {
        ok(`Settles ${currency.toUpperCase()}`, `${amount} held · payouts have run in this currency`);
      } else if (primary) {
        // The first payout simply has not happened yet; the schedule will take it.
        ok(`Settles ${currency.toUpperCase()}`, `${amount} held · primary currency, no payout yet`);
      } else {
        warn(
          `Settles ${currency.toUpperCase()}`,
          `${amount} held and never paid out. Either attach a ${currency.toUpperCase()} bank `
            + "account (Balances → add a settlement currency) or Stripe converts it to "
            + `${a.default_currency.toUpperCase()} at 2%`,
        );
      }
    }

    const tax = await api("/v1/tax/settings");
    if (tax.body?.status === "active") {
      const regs = await api("/v1/tax/registrations?status=active&limit=20");
      const countries = (regs.body.data ?? []).map((r) => r.country);
      ok(
        "Stripe Tax",
        countries.length
          ? `active · registered in ${countries.join(", ")}`
          : "active, but registered nowhere — no sale will record any tax",
      );
      if (!countries.length) {
        warn("GST", "no tax registration, so Australian sales record no GST for the BAS");
      }
    } else {
      const pending = tax.body?.status_details?.pending?.missing_fields ?? [];
      warn(
        "Stripe Tax",
        `${tax.body?.status ?? "unreadable"}${pending.length ? ` — missing ${pending.join(", ")}` : ""}`,
      );
    }

    const hooks = await api("/v1/webhook_endpoints?limit=10");
    const live = (hooks.body.data ?? []).filter((h) => h.status === "enabled");
    if (live.length) {
      ok("Stripe webhook", `${live.length} enabled · ${live[0].url}`);
    } else {
      stop(
        "Stripe webhook",
        "no enabled endpoint. Payments would succeed and nobody would ever be given access",
      );
    }
  }
}

/* -- 7. which currencies can actually take money? ------------------------- */

/* Cards are switched off, so a currency sells only if it has a direct debit
   scheme that is activated. That makes "is this site able to sell?" a real
   question with a per-currency answer, and the failure is silent: the buttons
   simply are not there, and the first sign is sales that never arrive. */

const { CATALOGUE, CURRENCIES, amountFor, offersPayInFull } = await import("../src/lib/catalogue.ts");
const { bankDebitFor, schemeFor } = await import("../src/lib/payments/bank-debit.ts");

const dark = [];
for (const ccy of CURRENCIES) {
  const scheme = schemeFor(ccy);
  const sellable = CATALOGUE.filter((sku) => {
    const full = offersPayInFull(sku) && bankDebitFor(ccy, amountFor(sku, ccy, "full")).ok;
    const monthly = sku.instalments && bankDebitFor(ccy, amountFor(sku, ccy, "instalments")).ok;
    return full || monthly;
  }).length;

  if (sellable === CATALOGUE.length) {
    ok(`Sells in ${ccy.toUpperCase()}`, `all ${sellable} products · ${scheme.label}`);
  } else if (sellable > 0) {
    warn(`Sells in ${ccy.toUpperCase()}`, `only ${sellable} of ${CATALOGUE.length} products via ${scheme.label}`);
  } else {
    dark.push(ccy.toUpperCase());
    const why = scheme
      ? `${scheme.label} is not activated — request it at dashboard.stripe.com/settings/payment_methods`
      : "no direct debit scheme is open to an Australian business (ACH is US/EU only)";
    warn(`Sells in ${ccy.toUpperCase()}`, `NOTHING — ${why}`);
  }
}

if (dark.length === CURRENCIES.length) {
  stop("Storefront", "no currency can take a payment; every buy button is dead");
} else if (dark.length) {
  warn("Storefront", `${dark.join(", ")} cannot take any payment — those sites show no buy button`);
}

/* -- report --------------------------------------------------------------- */

console.log(`\nPreflight${envName ? ` · ${envName}` : ""}\n`);
for (const r of results) {
  console.log(`${MARK[r.level]} ${r.what.padEnd(30)} ${r.detail}`);
}

const stops = results.filter((r) => r.level === "stop");
const warns = results.filter((r) => r.level === "warn");

console.log("");
if (stops.length > 0) {
  console.log(`${stops.length} thing${stops.length === 1 ? "" : "s"} to fix before this is a working deploy.`);
  console.log("A deploy will still succeed — it just will not do what you want.\n");
  process.exit(1);
}
console.log(
  warns.length > 0
    ? `Ready. ${warns.length} optional thing${warns.length === 1 ? "" : "s"} not configured — see the notes above.\n`
    : "Ready.\n",
);
