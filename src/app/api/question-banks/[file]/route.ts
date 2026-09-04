import { NextResponse } from "next/server";

import { PAID_HEADERS, refusePaidContent } from "@/lib/paid-access";
import { questionBankFile } from "@/lib/question-banks";

export const dynamic = "force-dynamic";

/**
 * The paid question banks.
 *
 * This is the only route that can produce them, and it answers nothing until
 * `refusePaidContent()` has agreed that the caller may have them. The marketing
 * site publishes one free question per bank and simply does not contain the
 * rest — so this endpoint, not a flag in a JSON file, is what stands between a
 * subscription and 2,868 questions.
 *
 * A student who has not paid gets 403 with a reason, never a partial bank: an
 * endpoint that returns some questions to everybody is a harder thing to reason
 * about than one that returns all or nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const refusal = await refusePaidContent();
  if (refusal) return refusal;

  const { file } = await params;
  // Looked up in a fixed map, so a name like "../../.env" simply is not a key.
  const payload = questionBankFile(file);
  if (!payload) {
    return NextResponse.json({ error: "No such question bank." }, { status: 404 });
  }
  return NextResponse.json(payload, { headers: PAID_HEADERS });
}
