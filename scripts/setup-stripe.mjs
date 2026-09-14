#!/usr/bin/env node
/* ==========================================================================
   Stripe setup
   --------------------------------------------------------------------------
   Creates the products and prices in Stripe from the catalogue, and records
   the resulting price IDs in src/lib/stripe-prices.generated.ts.

   Thirteen SKUs, four currencies, and a second recurring price for each of the
   five instalment plans. Doing that by hand in the Dashboard is about a hundred
   fields, and a single fat-fingered unit_amount is a real charge at the wrong
   price that nobody catches until a customer complains. So it is done from the
   catalogue, which the tests already hold to the rounding and divisibility
   rules.

   Read-only unless asked:

     npm run stripe:setup            what it would do, changing nothing
     npm run stripe:setup -- --apply actually create and update

   Idempotent. Run it as often as you like. Prices in Stripe are immutable, so
   when an amount changes the script creates a replacement, moves the lookup key
   onto it, and archives the old one — existing subscriptions keep billing the
   price they were created with, which is the behaviour you want for anyone
   mid-instalment-plan.

   Run it once per mode. Test and live have separate price IDs; the key decides
   which, and the generated file holds both.
   ========================================================================== */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Stripe from "stripe";

/* The catalogue is TypeScript. test/alias-hooks.mjs is the loader that lets
   Node import it directly — it lives under test/ because that is what needed it
   first, but there is nothing test-specific about it. */
import { CATALOGUE, CURRENCIES, amountFor, toMinorUnits } from "../src/lib/catalogue.ts";
import { STRIPE_PRICES } from "../src/lib/stripe-prices.generated.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const GENERATED = path.join(root, "src", "lib", "stripe-prices.generated.ts");

const apply = process.argv.includes("--apply");

/* -- output --------------------------------------------------------------- */

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

function die(message, hint) {
  console.error(`\n${red("Stopped.")} ${message}`);
  if (hint) console.error(dim(`\n${hint}`));
  process.exit(1);
}

/* -- environment ---------------------------------------------------------- */

for (const file of [".env.local", ".env"]) {
  const candidate = path.join(root, file);
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!secretKey) {
  die(
    "No STRIPE_SECRET_KEY found.",
    "Get it from dashboard.stripe.com → Developers → API keys, then put it in\n" +
      "portal/.env.local as STRIPE_SECRET_KEY=sk_test_…\n\n" +
      "The account you created through Xero is a normal Stripe account — sign in\n" +
      "with the same email. Start in TEST mode; switch the dashboard toggle to see\n" +
      "the test keys.",
  );
}

const mode = secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")
  ? "live"
  : secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")
    ? "test"
    : null;

if (!mode) die(`STRIPE_SECRET_KEY does not look like a secret key (got "${secretKey.slice(0, 8)}…").`);

const stripe = new Stripe(secretKey);

/* -- what the catalogue says should exist --------------------------------- */

/** Stripe's default currency for a price, plus the rest as currency_options. */
const BASE = "usd";

function amountsFor(sku, plan) {
  const out = {};
  for (const c of CURRENCIES) out[c] = toMinorUnits(amountFor(sku, c, plan));
  return out;
}

function priceSpec(sku, plan) {
  const amounts = amountsFor(sku, plan);
  const currencyOptions = {};
  for (const c of CURRENCIES) {
    if (c === BASE) continue;
    // tax_behavior is inherited from the top level; setting it per currency as
    // well is allowed but pointless while every currency is inclusive.
    currencyOptions[c] = { unit_amount: amounts[c] };
  }
  return {
    lookupKey: `oys_${sku.slug}_${plan === "instalments" ? "inst" : "full"}`,
    amounts,
    params: {
      product: productIdFor(sku),
      currency: BASE,
      unit_amount: amounts[BASE],
      currency_options: currencyOptions,
      // Every catalogue price is tax-inclusive. AUD must be, under Australian
      // Consumer Law's single-price rule, and the amount already contains the
      // 10% GST. The others carry no tax today; if a UK or EU VAT registration
      // is ever added, this means the VAT comes OUT of the advertised price
      // rather than being added to it. That is the right answer for consumer
      // pricing in both places, but it is a margin decision, so: noted here.
      tax_behavior: "inclusive",
      ...(plan === "instalments" ? { recurring: { interval: "month" } } : {}),
      metadata: {
        oys_slug: sku.slug,
        oys_plan: plan,
        ...(plan === "instalments" ? { oys_instalment_months: String(sku.instalments.months) } : {}),
      },
    },
  };
}

const productIdFor = (sku) => `oys_${sku.slug}`;

/* -- reconcile ------------------------------------------------------------ */

const actions = [];
const resolved = {};

function record(slug, plan, priceId) {
  resolved[slug] ??= {};
  resolved[slug][plan === "instalments" ? "instalments" : "full"] = priceId;
}

async function ensureProduct(sku) {
  const id = productIdFor(sku);
  let existing = null;
  try {
    existing = await stripe.products.retrieve(id);
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
  }

  const desired = { name: sku.name, description: sku.blurb };

  if (!existing) {
    actions.push({ kind: "product+", what: sku.slug, detail: sku.name });
    if (apply) await stripe.products.create({ id, ...desired, metadata: { oys_slug: sku.slug } });
    return;
  }
  if (existing.name !== desired.name || existing.description !== desired.description) {
    actions.push({ kind: "product~", what: sku.slug, detail: "name or description changed" });
    if (apply) await stripe.products.update(id, desired);
  }
}

function sameAmounts(price, amounts) {
  if (price.unit_amount !== amounts[BASE]) return false;
  for (const c of CURRENCIES) {
    if (c === BASE) continue;
    if (price.currency_options?.[c]?.unit_amount !== amounts[c]) return false;
  }
  return true;
}

async function ensurePrice(sku, plan) {
  const spec = priceSpec(sku, plan);

  const found = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
    expand: ["data.currency_options"],
  });
  const existing = found.data[0] ?? null;

  const money = CURRENCIES.map((c) => `${c}${(spec.amounts[c] / 100).toLocaleString()}`).join(" ");

  if (existing && sameAmounts(existing, spec.amounts)) {
    record(sku.slug, plan, existing.id);
    actions.push({ kind: "price=", what: spec.lookupKey, detail: money });
    return;
  }

  if (existing) {
    // Prices are immutable: the amount cannot be edited. Create the replacement,
    // move the lookup key to it, then archive the old one. Anyone already on an
    // instalment plan keeps billing against the price they signed up at.
    actions.push({ kind: "price~", what: spec.lookupKey, detail: `re-priced → ${money}` });
    if (apply) {
      const created = await stripe.prices.create({
        ...spec.params,
        lookup_key: spec.lookupKey,
        transfer_lookup_key: true,
      });
      await stripe.prices.update(existing.id, { active: false });
      record(sku.slug, plan, created.id);
    }
    return;
  }

  actions.push({ kind: "price+", what: spec.lookupKey, detail: money });
  if (apply) {
    const created = await stripe.prices.create({ ...spec.params, lookup_key: spec.lookupKey });
    record(sku.slug, plan, created.id);
  }
}

/* -- the generated file --------------------------------------------------- */

/** What is already recorded, so running one mode never wipes the other's IDs. */
function existingGenerated() {
  return structuredClone(STRIPE_PRICES);
}

function renderGenerated(merged) {
  const header = readFileSync(GENERATED, "utf8").split("export const STRIPE_PRICES")[0];
  const hasAnyId = (entry) =>
    ["full", "instalments"].some((k) => entry?.[k] && Object.keys(entry[k]).length > 0);
  const slugs = CATALOGUE.map((s) => s.slug).filter((slug) => hasAnyId(merged[slug]));

  const body = slugs
    .map((slug) => {
      const entry = merged[slug];
      const parts = ["full", "instalments"]
        .filter((k) => entry[k] && Object.keys(entry[k]).length > 0)
        .map((k) => {
          const refs = ["test", "live"]
            .filter((m) => entry[k][m])
            .map((m) => `${m}: "${entry[k][m]}"`)
            .join(", ");
          return `    ${k}: { ${refs} },`;
        })
        .join("\n");
      return `  "${slug}": {\n${parts}\n  },`;
    })
    .join("\n");

  return `${header}export const STRIPE_PRICES: Readonly<Record<string, SkuPrices>> = {\n${body}\n};\n`;
}

/* -- run ------------------------------------------------------------------ */

console.log(
  `\n${bold("Stripe setup")} — ${mode === "live" ? red("LIVE mode") : green("test mode")}` +
    `  ${dim(apply ? "applying changes" : "dry run, nothing will change")}\n`,
);

for (const sku of CATALOGUE) {
  await ensureProduct(sku);
  await ensurePrice(sku, "full");
  if (sku.instalments) await ensurePrice(sku, "instalments");
}

const LABEL = {
  "product+": green("create product"),
  "product~": yellow("update product"),
  "price+": green("create price  "),
  "price~": yellow("re-price      "),
  "price=": dim("unchanged     "),
};

for (const a of actions) {
  console.log(`  ${LABEL[a.kind]}  ${a.what.padEnd(30)} ${dim(a.detail)}`);
}

const changes = actions.filter((a) => a.kind !== "price=").length;

if (!apply) {
  console.log(
    `\n${changes} change${changes === 1 ? "" : "s"} to make. ` +
      `Re-run with ${bold("--apply")} to make them.\n`,
  );
  process.exit(0);
}

const merged = existingGenerated();
for (const [slug, refs] of Object.entries(resolved)) {
  merged[slug] ??= {};
  for (const [plan, id] of Object.entries(refs)) {
    merged[slug][plan] ??= {};
    merged[slug][plan][mode] = id;
  }
}
writeFileSync(GENERATED, renderGenerated(merged));

const priced = Object.keys(merged).length;
console.log(
  `\n${green("Done.")} ${changes} change${changes === 1 ? "" : "s"} applied. ` +
    `${priced}/${CATALOGUE.length} SKUs now have ${mode} prices.\n` +
    dim(`Recorded in src/lib/stripe-prices.generated.ts — commit it.\n`),
);
