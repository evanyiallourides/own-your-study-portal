/* ==========================================================================
   Meeting links
   --------------------------------------------------------------------------
   A meeting link is pasted by a person, so it arrives in every shape a person
   can produce: with tracking parameters, wrapped in a calendar's redirector,
   as a bare Google Meet code, or with the scheme missing entirely. This module
   turns any of those into one canonical link plus the few facts the interface
   needs — which platform, what code to read out, whether it can be dialled.

   Everything here is pure and has no imports beyond the shared types, so it
   runs identically in a server action, in the browser, and in a test.
   ========================================================================== */

import type { MeetingPlatform } from "@/lib/types";

export interface MeetingLink {
  /** Detected from the URL itself, never from what someone selected. */
  platform: MeetingPlatform;
  /** The link to actually open. Safe parameters preserved, junk removed. */
  url: string;
  /** Human-readable meeting identity — "abc-defg-hij", "812 3456 7890". */
  code: string | null;
  /** "Google Meet", "Zoom", "Microsoft Teams", or the hostname. */
  label: string;
  /** True when the platform needs a passcode that is not in the URL. */
  passcodeInUrl: boolean;
}

export const MEETING_PLATFORM_LABEL: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  other: "Video call",
};

/* A Google Meet code is three letters, four letters, three letters. Anything
   else on meet.google.com is a nickname or a lookup, which we keep but cannot
   present as a code. */
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/* Parameters that only ever carry analytics. Everything else is preserved,
   because Zoom's `pwd` and Teams' `context` are load-bearing and stripping
   them silently breaks the link. */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
]);

/** Calendar invitations and mail clients wrap links in their own redirector.
 *  The real link is a parameter on it. */
function unwrapRedirect(url: URL): URL {
  const host = url.hostname.toLowerCase();

  const wrappers: Record<string, string> = {
    "www.google.com": "q", // /url?q=…
    "google.com": "q",
    "safelinks.protection.outlook.com": "url",
    "eur01.safelinks.protection.outlook.com": "url",
    "eur02.safelinks.protection.outlook.com": "url",
    "eur03.safelinks.protection.outlook.com": "url",
    "l.facebook.com": "u",
    "out.reddit.com": "url",
  };

  const param = wrappers[host];
  if (!param) return url;

  const inner = url.searchParams.get(param);
  if (!inner) return url;

  try {
    return new URL(inner);
  } catch {
    return url;
  }
}

function stripTracking(url: URL): URL {
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  // A trailing "?" left behind by the deletions reads as a broken link.
  if ([...url.searchParams.keys()].length === 0) url.search = "";
  return url;
}

function detect(url: URL): { platform: MeetingPlatform; code: string | null } {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+|\/+$/g, "");

  if (host === "meet.google.com") {
    // /abc-defg-hij, /lookup/nickname, /_meet/abc-defg-hij
    const last = path.split("/").pop() ?? "";
    return { platform: "google_meet", code: MEET_CODE.test(last) ? last : null };
  }

  if (host.endsWith("zoom.us") || host.endsWith("zoomgov.com")) {
    // /j/81234567890, /w/812…, /my/name
    const digits = path.match(/(?:^|\/)(\d{9,12})(?:\/|$)/)?.[1] ?? null;
    return { platform: "zoom", code: digits ? formatZoomId(digits) : null };
  }

  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) {
    const digits = path.match(/(?:^|\/)(\d{9,13})(?:\/|$)/)?.[1] ?? null;
    return { platform: "teams", code: digits };
  }

  if (host === "whereby.com" || host.endsWith(".whereby.com")) {
    return { platform: "other", code: path || null };
  }

  return { platform: "other", code: null };
}

/** Zoom shows its ids in 3-4-4 or 3-3-4 groups; matching that makes them
 *  readable aloud, which is how they are usually shared. */
function formatZoomId(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return digits;
}

/**
 * Turn whatever was pasted into a canonical link, or null if it cannot be one.
 *
 * Accepts a bare Google Meet code, because that is what people copy out of a
 * calendar entry more often than the full URL.
 */
export function parseMeetingLink(raw: string | null | undefined): MeetingLink | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // A bare Meet code is unambiguous — nothing else looks like xxx-xxxx-xxx.
  if (MEET_CODE.test(trimmed.toLowerCase())) {
    const code = trimmed.toLowerCase();
    return {
      platform: "google_meet",
      url: `https://meet.google.com/${code}`,
      code,
      label: MEETING_PLATFORM_LABEL.google_meet,
      passcodeInUrl: false,
    };
  }

  let url: URL;
  try {
    // "meet.google.com/abc-defg-hij" with no scheme is still a link people paste.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;

  url = stripTracking(unwrapRedirect(url));

  // Meeting links are always https in practice; upgrading a pasted http link
  // is safer than opening it as given.
  url.protocol = "https:";

  const { platform, code } = detect(url);

  return {
    platform,
    url: url.toString(),
    code,
    label:
      platform === "other"
        ? url.hostname.replace(/^www\./, "")
        : MEETING_PLATFORM_LABEL[platform],
    passcodeInUrl: url.searchParams.has("pwd") || url.searchParams.has("passcode"),
  };
}

/** True when the string is something we would accept. Used by forms to show a
 *  hint while typing rather than only on submit. */
export function isUsableMeetingLink(raw: string | null | undefined): boolean {
  return parseMeetingLink(raw) !== null;
}

/** A Google Meet link this portal generated, or one pasted in. Both are real
 *  Meet links; only the provenance differs. */
export function isGoogleMeet(raw: string | null | undefined): boolean {
  return parseMeetingLink(raw)?.platform === "google_meet";
}
