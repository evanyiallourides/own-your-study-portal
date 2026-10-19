/* ==========================================================================
   Checkout, framed
   --------------------------------------------------------------------------
   The marketing site opens checkout in a sheet on its own page — an iframe
   pointed at /checkout/<slug>?embed=1 — so that a buyer never has to leave
   ownyourstudy.com to pay.

   Everything here is pure, because most of it is a decision about who may
   frame what, and a decision like that deserves a test rather than trust.

   The rule worth stating plainly: *only* the checkout may be framed, and only
   by the marketing site. Everything else on the portal — /login, every page
   behind it — stays unframeable, because a framed login or admin page is a
   clickjacking surface and nothing about taking a payment needs one.
   ========================================================================== */

/** The only origins allowed to put checkout in a frame. */
export const EMBED_ORIGINS = ["https://ownyourstudy.com", "https://www.ownyourstudy.com"] as const;

/**
 * The paths that may be framed: the checkout pages, and the route their form
 * posts to. A path-to-regexp pattern — the same dialect Next's `headers()`
 * takes — written as the *complement* so the rest of the portal can keep
 * `X-Frame-Options: DENY` without the two headers ever being sent together.
 */
export const UNFRAMEABLE_SOURCE = "/((?!checkout(?:/|$)|api/checkout(?:/|$)).*)";
export const FRAMEABLE_SOURCES = ["/checkout/:path*", "/api/checkout"] as const;

/** The CSP that lets the marketing site — and, locally, localhost — frame checkout. */
export function frameAncestors(development: boolean): string {
  const origins: string[] = [...EMBED_ORIGINS];
  // Never in production: a localhost entry there would let any page on a
  // visitor's own machine frame checkout.
  if (development) origins.push("http://localhost:*", "http://127.0.0.1:*");
  return `frame-ancestors ${origins.join(" ")}`;
}

/** `?embed=1` is the whole of the embed protocol on the way in. */
export function isEmbed(value: string | string[] | null | undefined): boolean {
  return value === "1";
}

/* -- errors shown in the sheet ------------------------------------------- */

/*
 * A refusal normally comes back as JSON, which is right for a script and
 * wrong inside a sheet — the buyer would see a raw object. So in embed mode
 * the route sends them back to the form with a *code*, and the form looks the
 * wording up here.
 *
 * Codes, not messages, on purpose: a message in the URL would let anybody
 * craft a link to our checkout that says whatever they like on it.
 */
export type CheckoutErrorCode = "email" | "waiver" | "unavailable" | "failed";

const ERROR_MESSAGES: Record<CheckoutErrorCode, string> = {
  email: "Please enter a valid email address.",
  waiver: "Please confirm you want access straight away.",
  unavailable: "We can’t take this payment online right now. Please get in touch and we will sort it out.",
  failed: "We couldn’t start your checkout. Please try again.",
};

export function isCheckoutErrorCode(value: string | null | undefined): value is CheckoutErrorCode {
  return value === "email" || value === "waiver" || value === "unavailable" || value === "failed";
}

/** The wording for `?error=`, or null for anything that is not one of ours. */
export function checkoutErrorMessage(value: string | string[] | null | undefined): string | null {
  return typeof value === "string" && isCheckoutErrorCode(value) ? ERROR_MESSAGES[value] : null;
}

/** Where a refused embedded checkout goes back to — the same form, with the reason. */
export function checkoutErrorPath(input: {
  slug: string;
  site: string | null;
  currency: string | null;
  code: CheckoutErrorCode;
}): string {
  const params = new URLSearchParams();
  if (input.site) params.set("site", input.site);
  if (input.currency) params.set("ccy", input.currency);
  params.set("embed", "1");
  params.set("error", input.code);
  return `/checkout/${encodeURIComponent(input.slug)}?${params.toString()}`;
}

/** The instructions page for an order, carrying the embed flag when there is one. */
export function instructionsPath(orderId: string, embed: boolean): string {
  return `/checkout/instructions/${orderId}${embed ? "?embed=1" : ""}`;
}
