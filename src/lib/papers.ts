import "server-only";

/**
 * The full mock papers. Same arrangement as the question banks, and for the
 * same reasons — see `question-banks.ts`.
 *
 * Regenerate with:
 *   python3 tools/papers/build_papers.py private/papers own-your-ib/papers
 *   ./tools/sync-portal-banks.sh
 */
import bioHlP1aM26 from "@/data/papers/bio-hl-p1a-m26.json";
import bioHlP1aTz1N25 from "@/data/papers/bio-hl-p1a-tz1-n25.json";
import bioHlP1aTz3N25 from "@/data/papers/bio-hl-p1a-tz3-n25.json";
import bioHlP1bM26 from "@/data/papers/bio-hl-p1b-m26.json";
import bioHlP1bTz1N25 from "@/data/papers/bio-hl-p1b-tz1-n25.json";
import bioHlP1bTz3N25 from "@/data/papers/bio-hl-p1b-tz3-n25.json";
import bioHlP2Tz1N25 from "@/data/papers/bio-hl-p2-tz1-n25.json";
import bioHlP2Tz3N25 from "@/data/papers/bio-hl-p2-tz3-n25.json";
import bioSlP1aTz1N25 from "@/data/papers/bio-sl-p1a-tz1-n25.json";
import bioSlP1aTz3N25 from "@/data/papers/bio-sl-p1a-tz3-n25.json";
import bioSlP1bTz1N25 from "@/data/papers/bio-sl-p1b-tz1-n25.json";
import bioSlP1bTz3N25 from "@/data/papers/bio-sl-p1b-tz3-n25.json";
import bioSlP2Tz1N25 from "@/data/papers/bio-sl-p2-tz1-n25.json";
import bioSlP2Tz3N25 from "@/data/papers/bio-sl-p2-tz3-n25.json";
import chemHlP1aM26 from "@/data/papers/chem-hl-p1a-m26.json";
import chemHlP1bM26 from "@/data/papers/chem-hl-p1b-m26.json";
import index from "@/data/papers/index.json";
import mathAaHlP1TzaM26 from "@/data/papers/math-aa-hl-p1-tza-m26.json";
import mathAaHlP2TzaM26 from "@/data/papers/math-aa-hl-p2-tza-m26.json";
import mathAaHlP3TzaM26 from "@/data/papers/math-aa-hl-p3-tza-m26.json";
import mathAaSlP1TzaM26 from "@/data/papers/math-aa-sl-p1-tza-m26.json";
import mathAaSlP1TzcM26 from "@/data/papers/math-aa-sl-p1-tzc-m26.json";
import mathAaSlP2TzaM26 from "@/data/papers/math-aa-sl-p2-tza-m26.json";
import mathAaSlP2TzcM26 from "@/data/papers/math-aa-sl-p2-tzc-m26.json";

const FILES: Record<string, unknown> = {
  "bio-hl-p1a-m26.json": bioHlP1aM26,
  "bio-hl-p1a-tz1-n25.json": bioHlP1aTz1N25,
  "bio-hl-p1a-tz3-n25.json": bioHlP1aTz3N25,
  "bio-hl-p1b-m26.json": bioHlP1bM26,
  "bio-hl-p1b-tz1-n25.json": bioHlP1bTz1N25,
  "bio-hl-p1b-tz3-n25.json": bioHlP1bTz3N25,
  "bio-hl-p2-tz1-n25.json": bioHlP2Tz1N25,
  "bio-hl-p2-tz3-n25.json": bioHlP2Tz3N25,
  "bio-sl-p1a-tz1-n25.json": bioSlP1aTz1N25,
  "bio-sl-p1a-tz3-n25.json": bioSlP1aTz3N25,
  "bio-sl-p1b-tz1-n25.json": bioSlP1bTz1N25,
  "bio-sl-p1b-tz3-n25.json": bioSlP1bTz3N25,
  "bio-sl-p2-tz1-n25.json": bioSlP2Tz1N25,
  "bio-sl-p2-tz3-n25.json": bioSlP2Tz3N25,
  "chem-hl-p1a-m26.json": chemHlP1aM26,
  "chem-hl-p1b-m26.json": chemHlP1bM26,
  "index.json": index,
  "math-aa-hl-p1-tza-m26.json": mathAaHlP1TzaM26,
  "math-aa-hl-p2-tza-m26.json": mathAaHlP2TzaM26,
  "math-aa-hl-p3-tza-m26.json": mathAaHlP3TzaM26,
  "math-aa-sl-p1-tza-m26.json": mathAaSlP1TzaM26,
  "math-aa-sl-p1-tzc-m26.json": mathAaSlP1TzcM26,
  "math-aa-sl-p2-tza-m26.json": mathAaSlP2TzaM26,
  "math-aa-sl-p2-tzc-m26.json": mathAaSlP2TzcM26,
};

export function paperFile(name: string): unknown | null {
  return Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : null;
}

interface PaperSummary {
  id: string;
  subject: string;
  short: string;
  level: string;
  paper: string;
  zone: string | null;
  session: string;
  count: number;
  maxMark: number;
  durationMinutes: number | null;
}

export function paperIndex(): PaperSummary[] {
  return ((FILES["index.json"] as { papers?: PaperSummary[] }).papers ?? []) as PaperSummary[];
}

export function paperCount(): number {
  return paperIndex().length;
}

export function paperMarks(): number {
  return paperIndex().reduce((total, p) => total + p.maxMark, 0);
}
