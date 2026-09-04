import { NextResponse } from "next/server";

import { PAID_HEADERS, refusePaidContent } from "@/lib/paid-access";
import { paperFile } from "@/lib/papers";

export const dynamic = "force-dynamic";

/**
 * The paid mock papers.
 *
 * The marketing site publishes one complete paper and holds the other
 * twenty-two as titles and mark totals only. This endpoint is what serves the
 * rest, and it answers nothing before `refusePaidContent()` has agreed — the
 * same check the question banks use, so the two cannot disagree about who has
 * paid.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const refusal = await refusePaidContent();
  if (refusal) return refusal;

  const { file } = await params;
  const payload = paperFile(file);
  if (!payload) {
    return NextResponse.json({ error: "No such paper." }, { status: 404 });
  }
  return NextResponse.json(payload, { headers: PAID_HEADERS });
}
