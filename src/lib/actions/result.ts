import { AccessDeniedError, NotFoundError } from "@/lib/data/repository";

/** Every server action returns this shape. The UI can then always render an
 *  error inline rather than letting an exception become an error page. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Turns whatever went wrong into something safe to put on a screen. Database
 * messages can name columns and constraints, which is useful in a log and
 * unhelpful — occasionally revealing — in an interface.
 */
export function toActionError(error: unknown): { ok: false; error: string } {
  if (error instanceof AccessDeniedError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof NotFoundError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error) {
    // Deliberately not the raw message unless it was one we wrote ourselves.
    const known = KNOWN_MESSAGES.find((m) => error.message.includes(m));
    if (known) return { ok: false, error: error.message };
    console.error("[action]", error.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  console.error("[action] unknown error", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

const KNOWN_MESSAGES = [
  "cannot be published without a summary",
  "not assigned",
  "does not exist",
  "not available in demo mode",
  "consent",
];
