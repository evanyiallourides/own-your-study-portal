import "server-only";

/**
 * The full IB question banks — the paid content.
 *
 * Imported, not fetched. They are static content versioned with the code, and
 * at 1.8 MB they sit well inside Vercel's 250 MB serverless budget, so there is
 * no store to configure and no second place for the permission to be wrong.
 *
 * (They spent a detour in Cloudflare R2, on the mistaken belief that this
 * deployed to a Workers script capped at 3 MiB. It deploys to Vercel. Bundling
 * is both simpler and one less thing to keep in sync.)
 *
 * The files live under `src/`, which never reaches the browser; `public/` would
 * have published them to anyone who guessed the path. `server-only` above turns
 * an accidental import from a client component into a build error rather than a
 * leak.
 *
 * Regenerate with:
 *   python3 tools/question-banks/build_banks.py private/question-banks own-your-ib/question-banks
 *   ./tools/sync-portal-banks.sh
 */
import bioHlP1 from "@/data/question-banks/bio-hl-p1.json";
import bioHlP2 from "@/data/question-banks/bio-hl-p2.json";
import bioSlP1 from "@/data/question-banks/bio-sl-p1.json";
import bioSlP2 from "@/data/question-banks/bio-sl-p2.json";
import chemHlP1 from "@/data/question-banks/chem-hl-p1.json";
import chemHlP2 from "@/data/question-banks/chem-hl-p2.json";
import chemSlP1 from "@/data/question-banks/chem-sl-p1.json";
import chemSlP2 from "@/data/question-banks/chem-sl-p2.json";
import guidance from "@/data/question-banks/guidance.json";
import index from "@/data/question-banks/index.json";
import mathAaHlP1 from "@/data/question-banks/math-aa-hl-p1.json";
import mathAaHlP2 from "@/data/question-banks/math-aa-hl-p2.json";
import mathAaHlP3 from "@/data/question-banks/math-aa-hl-p3.json";
import mathAaSlP1 from "@/data/question-banks/math-aa-sl-p1.json";
import mathAaSlP2 from "@/data/question-banks/math-aa-sl-p2.json";
import mathAiHlP3 from "@/data/question-banks/math-ai-hl-p3.json";

/**
 * Every file the API will serve, by the name it is requested under. A fixed map
 * rather than a path join: the request never touches the filesystem, so no
 * amount of "../" in a URL can reach anything absent from this list.
 */
const FILES: Record<string, unknown> = {
  "bio-hl-p1.json": bioHlP1,
  "bio-hl-p2.json": bioHlP2,
  "bio-sl-p1.json": bioSlP1,
  "bio-sl-p2.json": bioSlP2,
  "chem-hl-p1.json": chemHlP1,
  "chem-hl-p2.json": chemHlP2,
  "chem-sl-p1.json": chemSlP1,
  "chem-sl-p2.json": chemSlP2,
  "guidance.json": guidance,
  "index.json": index,
  "math-aa-hl-p1.json": mathAaHlP1,
  "math-aa-hl-p2.json": mathAaHlP2,
  "math-aa-hl-p3.json": mathAaHlP3,
  "math-aa-sl-p1.json": mathAaSlP1,
  "math-aa-sl-p2.json": mathAaSlP2,
  "math-ai-hl-p3.json": mathAiHlP3,
};

export function questionBankFile(name: string): unknown | null {
  return Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : null;
}

interface BankSummary {
  id: string;
  subject: string;
  short: string;
  level: string;
  paper: string;
  count: number;
  topics: { title: string; count: number }[];
}

export function questionBankIndex(): BankSummary[] {
  return ((FILES["index.json"] as { banks?: BankSummary[] }).banks ?? []) as BankSummary[];
}

export function questionCount(): number {
  return questionBankIndex().reduce((total, b) => total + b.count, 0);
}
