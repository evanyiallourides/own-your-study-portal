import "server-only";

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { paidContentAvailable } from "@/lib/env";

/**
 * The check that stands between a subscription and the paid material.
 *
 * The question banks and the mock papers are sold together and gated together,
 * so they ask this one function rather than each carrying its own copy of the
 * rule. A second copy is how two endpoints end up disagreeing about who has
 * paid, and the one that is wrong is the one nobody notices.
 *
 * Returns a response to send when the caller may not have it, or null when they
 * may.
 */
export async function refusePaidContent(): Promise<NextResponse | null> {
  // The rule itself is in env.ts, where it can be tested without pulling in
  // next/server; this is only how the refusal is reported.
  if (!paidContentAvailable()) {
    return NextResponse.json(
      {
        error:
          "Question banks and papers are not served in demo mode. Sign in to a " +
          "real account, or set PORTAL_DEMO_PAID_CONTENT=true locally.",
      },
      { status: 403 },
    );
  }

  const session = await requireSession();
  const role = session.profile.role;

  // Tutors and administrators read it: they teach from it and they sell it.
  // Parents do not — nothing on their side of the portal uses it.
  if (role === "parent") {
    return NextResponse.json(
      { error: "This is on the student's account." },
      { status: 403 },
    );
  }

  if (role !== "student") return null;

  if (!session.studentId) {
    return NextResponse.json({ error: "No student record." }, { status: 403 });
  }

  const repo = await repositoryFor(session);
  const access = await repo.getQuestionBankAccess(session.studentId);
  if (!access.granted) {
    return NextResponse.json(
      {
        error: "Access is not active on this account.",
        pooledHours: access.pooledHours,
        freeAtHours: access.freeAtHours,
      },
      { status: 403 },
    );
  }
  return null;
}

/** Headers for a paid payload: private, because the answer depends on who asked. */
export const PAID_HEADERS = {
  "Cache-Control": "private, max-age=0, must-revalidate",
};
