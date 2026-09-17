/* ==========================================================================
   Getting text out of what the student uploaded
   --------------------------------------------------------------------------
   Dependency-free, and deliberately modest about what it claims.

   An IA arrives as a PDF exported from Word, a .docx, or occasionally pasted
   text. For a PDF the authoritative reader is the model itself — it is sent
   the file and sees the actual pages, which is the only way subscripts,
   superscripts, chemical formulae, matrices and table alignment survive. All
   three source packs say so in nearly the same words: "read page images for
   diagrams and tables that extraction misses", "chemical notation and table
   alignment need visual verification when parsing is ambiguous".

   So the extractor here is not trying to be a faithful renderer. It has three
   narrower jobs, and it is honest about each:

     1. Produce text for .docx and plain text, where extraction IS faithful.
     2. For a PDF, work out whether there is a text layer at all. A scanned
        photograph of a printout has none, and that is the single most useful
        thing to know before a review runs — it is the difference between "your
        conclusion is unsupported" and "we could not read your conclusion".
     3. Count words and hash the bytes, so a review can be traced to the exact
        file that produced it and a re-upload of the same document is
        recognisable.

   The PDF text it recovers is good enough for those jobs and not good enough
   to mark from, which is why `needsVisualReader` exists and why `mark.ts`
   sends the original bytes when it is set. Pretending otherwise is how a
   review ends up describing a table that extraction mangled.
   ========================================================================== */

export type SourceKind = "pdf" | "docx" | "text";

export interface ExtractedDocument {
  kind: SourceKind;
  /** Anchored text, ready to paste into a prompt. */
  text: string;
  /** What the anchors in `text` mean. */
  anchorKind: "page" | "paragraph";
  /** Anchors the model is allowed to cite. */
  anchors: string[];
  wordCount: number;
  /** Faults in the FILE. Never faults in the work. */
  warnings: string[];
  /**
   * True when this format needs the model to look at the original rather than
   * at extracted text. Set for every PDF, because even a good text layer loses
   * the layout that a table's meaning lives in.
   */
  needsVisualReader: boolean;
  /** SHA-256 of the uploaded bytes, truncated. Identifies the exact file. */
  hash: string;
  byteLength: number;
}

/** Bigger than any real IA, small enough to reject a mistake quickly. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Below this many words, a "complete report" is not one. */
const THIN_DOCUMENT_WORDS = 400;

export class UnreadableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableUploadError";
  }
}

export async function extractDocument(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<ExtractedDocument> {
  if (bytes.byteLength === 0) {
    throw new UnreadableUploadError("That file is empty.");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UnreadableUploadError(
      `That file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB — export it as a PDF rather than embedding the raw photographs.`,
    );
  }

  const hash = await sha256(bytes);
  const kind = detectKind(fileName, bytes);

  switch (kind) {
    case "pdf":
      return extractPdf(bytes, hash);
    case "docx":
      return extractDocx(bytes, hash);
    default:
      return extractPlainText(bytes, hash);
  }
}

/* --------------------------------------------------------------------------
   What is this?
   --------------------------------------------------------------------------
   By magic bytes rather than by extension. A student renaming a .pages file to
   .docx is not rare, and the resulting failure — an unzip that produces
   nothing — is much less clear than saying so up front.
   -------------------------------------------------------------------------- */
function detectKind(fileName: string, bytes: ArrayBuffer): SourceKind {
  const head = new Uint8Array(bytes.slice(0, 4));

  // %PDF
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
  // PK\x03\x04 — a zip, which .docx is
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "docx";

  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return "text";
}

/* ==========================================================================
   PDF
   ========================================================================== */

async function extractPdf(bytes: ArrayBuffer, hash: string): Promise<ExtractedDocument> {
  const warnings: string[] = [];

  /* Two different questions, deliberately answered separately.

     HOW MANY PAGES ARE THERE is structural, and answerable reliably by
     counting page objects. It is what tells the rest of the system how much
     document the model has in front of it.

     IS THERE A TEXT LAYER is a quality signal from our own parser, which is
     approximate by design. Conflating the two is how a scanned IA — which the
     model reads perfectly well, because it is sent the pages — gets told "too
     little of this document could be read". That message would be false, and
     it would be sent to somebody who has paid. */
  const pageCount = pdfPageCount(bytes);
  const pages = await pdfPageText(bytes, warnings);
  const words = pages.reduce((sum, p) => sum + countWords(p), 0);

  if (words === 0) {
    warnings.push(
      "This PDF has no selectable text, so it is probably a scan or an export of images. " +
        "The pages themselves are still read, but anything handwritten or low-resolution may " +
        "not be legible, and we cannot check quotations against the text.",
    );
  } else if (words < THIN_DOCUMENT_WORDS) {
    warnings.push(
      `Only about ${words} words of selectable text were found, which is short for a full report. ` +
        "If most of your work is in images or equations, that is expected.",
    );
  }

  /* Anchors come from the page count rather than from what the text parser
     managed to split, so a citation of "p. 7" is checkable against a real page
     even when our own extraction of page 7 came back empty. */
  const anchorCount = Math.max(pageCount, pages.length, 1);
  const anchors = Array.from({ length: anchorCount }, (_, i) => `p. ${i + 1}`);

  const text = pages.length
    ? pages.map((page, i) => `[p. ${i + 1}]\n${page.trim()}`).join("\n\n")
    : "(No text layer. The pages themselves are attached and are the evidence.)";

  return {
    kind: "pdf",
    text,
    anchorKind: "page",
    anchors,
    wordCount: words,
    warnings,
    // Always. Even a clean text layer loses the column structure that makes a
    // results table mean anything.
    needsVisualReader: true,
    hash,
    byteLength: bytes.byteLength,
  };
}

/**
 * How many pages the file says it has.
 *
 * Counts `/Type /Page` objects, excluding `/Pages` — the node type for the
 * tree, which would otherwise be matched by a naive search and inflate the
 * count by one per level. Falls back to the `/Count` on the page tree root,
 * and then to zero, which callers treat as "unknown" rather than "empty".
 *
 * This is not a full parser and does not need to be: it is used to decide how
 * many page anchors exist, and being one out on a pathological file is a
 * citation that does not resolve rather than a wrong mark.
 */
export function pdfPageCount(bytes: ArrayBuffer): number {
  const haystack = latin1(new Uint8Array(bytes));

  // `/Type /Page` not followed by `s`, in any of the spacings producers use.
  const objects = haystack.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  if (objects && objects.length > 0) return objects.length;

  const count = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(haystack);
  return count?.[1] ? Number.parseInt(count[1], 10) : 0;
}

/**
 * Text per page, as far as a text layer allows.
 *
 * This walks the file's stream objects, inflates the ones that are Flate-
 * encoded, and pulls the arguments of the text-showing operators out of what
 * comes back. It does not implement fonts, encodings or positioning, so it
 * will lose ligatures, mangle some symbol fonts and run columns together.
 *
 * That is acceptable for what it is used for — deciding whether a text layer
 * exists and roughly how long the document is — and is why nothing marks from
 * the result. Page splitting is by content stream, which usually but not
 * always corresponds to a page; where it does not, the anchor count is wrong
 * and the model's own page numbers are the ones that get cited.
 */
async function pdfPageText(bytes: ArrayBuffer, warnings: string[]): Promise<string[]> {
  const raw = new Uint8Array(bytes);
  const pages: string[] = [];
  let inflateFailures = 0;

  for (const stream of findStreams(raw)) {
    let body = stream.body;

    if (stream.flate) {
      const inflated = await inflate(body);
      if (!inflated) {
        inflateFailures += 1;
        continue;
      }
      body = inflated;
    }

    const content = latin1(body);
    // A content stream shows text; an image or a font stream does not.
    if (!content.includes("BT") && !/\bTJ\b|\bTj\b/.test(content)) continue;

    const text = textFromContentStream(content);
    if (text.trim()) pages.push(text);
  }

  if (inflateFailures > 0 && pages.length === 0) {
    warnings.push(
      "The text layer of this PDF is compressed in a way we could not read. The pages themselves " +
        "are still reviewed.",
    );
  }

  return pages;
}

interface PdfStream {
  body: Uint8Array;
  flate: boolean;
}

/** Every `stream ... endstream` in the file, with whether it says it is Flate. */
function* findStreams(raw: Uint8Array): Generator<PdfStream> {
  const haystack = latin1(raw);
  const STREAM = "stream";
  const END = "endstream";

  let cursor = 0;
  while (cursor < haystack.length) {
    const start = haystack.indexOf(STREAM, cursor);
    if (start === -1) return;

    // The dictionary immediately before it says how the bytes are encoded.
    const dictionaryStart = Math.max(0, start - 600);
    const dictionary = haystack.slice(dictionaryStart, start);
    const flate = /\/Filter\s*(\/FlateDecode|\[\s*\/FlateDecode)/.test(dictionary);

    // "stream" is followed by CRLF or LF, and the bytes begin after it.
    let bodyStart = start + STREAM.length;
    if (haystack[bodyStart] === "\r") bodyStart += 1;
    if (haystack[bodyStart] === "\n") bodyStart += 1;

    const end = haystack.indexOf(END, bodyStart);
    if (end === -1) return;

    yield { body: raw.slice(bodyStart, end), flate };
    cursor = end + END.length;
  }
}

/**
 * The arguments of Tj, TJ, ' and " — the operators that put glyphs on a page.
 *
 * Strings are parenthesised with backslash escapes, or hex in angle brackets.
 * TJ takes an array mixing strings with kerning numbers, which are dropped.
 */
function textFromContentStream(content: string): string {
  const out: string[] = [];
  const blocks = content.split(/\bBT\b/).slice(1);

  for (const block of blocks) {
    const body = block.split(/\bET\b/)[0] ?? "";
    let line = "";

    // Literal strings, hex strings, and the operator that follows them.
    const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bT[Jj]\b|\bTd\b|\bTD\b|\bT\*\b/g;
    let match: RegExpExecArray | null;

    while ((match = token.exec(body)) !== null) {
      const piece = match[0];

      if (piece.startsWith("(")) {
        line += unescapePdfString(piece.slice(1, -1));
      } else if (piece.startsWith("<")) {
        line += hexString(piece.slice(1, -1));
      } else if (piece === "Td" || piece === "TD" || piece === "T*") {
        // A new line was started.
        if (line.trim()) out.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) out.push(line.trim());
  }

  return out.join("\n");
}

function unescapePdfString(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, escape: string) => {
    switch (escape) {
      case "n":
        return "\n";
      case "r":
        return "";
      case "t":
        return "\t";
      case "b":
      case "f":
        return "";
      case "(":
        return "(";
      case ")":
        return ")";
      case "\\":
        return "\\";
      default:
        return String.fromCharCode(Number.parseInt(escape, 8));
    }
  });
}

function hexString(value: string): string {
  const digits = value.replace(/\s+/g, "");
  let out = "";
  // Two digits per byte for simple fonts; UTF-16BE pairs come through as
  // two characters, which is wrong but harmless for counting words.
  for (let i = 0; i + 1 < digits.length; i += 2) {
    const code = Number.parseInt(digits.slice(i, i + 2), 16);
    if (code >= 32 && code < 127) out += String.fromCharCode(code);
  }
  return out;
}

/* ==========================================================================
   DOCX
   --------------------------------------------------------------------------
   A zip with the text in word/document.xml. Extraction here IS faithful —
   paragraphs are marked up as paragraphs — so a .docx needs no visual reader,
   and paragraph anchors are real rather than invented.
   ========================================================================== */

async function extractDocx(bytes: ArrayBuffer, hash: string): Promise<ExtractedDocument> {
  const warnings: string[] = [];
  const xml = await readZipEntry(new Uint8Array(bytes), "word/document.xml");

  if (!xml) {
    throw new UnreadableUploadError(
      "That looks like a zip file but not like a Word document. If it came from Pages or Google " +
        "Docs, export it as PDF or .docx first.",
    );
  }

  const paragraphs = docxParagraphs(latin1Decode(xml));
  if (paragraphs.length === 0) {
    throw new UnreadableUploadError("No text could be read out of that Word document.");
  }

  const words = paragraphs.reduce((sum, p) => sum + countWords(p), 0);
  if (words < THIN_DOCUMENT_WORDS) {
    warnings.push(
      `Only about ${words} words were found. If your working is in embedded images or equation ` +
        "objects, exporting as a PDF will let us read it properly.",
    );
  }

  /* Word's equation objects (OMML) and embedded images do not come out as
     text. Saying so is the difference between the student thinking the review
     missed their working and knowing why. */
  const xmlText = latin1Decode(xml);
  if (xmlText.includes("<m:oMath")) {
    warnings.push(
      "This document contains Word equation objects, which do not extract as text. Export as a " +
        "PDF and upload that instead if your mathematics is important to the review — which, in " +
        "an IA, it is.",
    );
  }
  if (xmlText.includes("<w:drawing")) {
    warnings.push("Embedded images and charts were not read. A PDF export includes them.");
  }

  const anchors = paragraphs.map((_, i) => `¶${i + 1}`);
  return {
    kind: "docx",
    text: paragraphs.map((p, i) => `[¶${i + 1}] ${p}`).join("\n"),
    anchorKind: "paragraph",
    anchors,
    wordCount: words,
    warnings,
    needsVisualReader: false,
    hash,
    byteLength: bytes.byteLength,
  };
}

function docxParagraphs(xml: string): string[] {
  const out: string[] = [];
  const paragraph = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let match: RegExpExecArray | null;

  while ((match = paragraph.exec(xml)) !== null) {
    const body = match[1] ?? "";
    const runs: string[] = [];
    const run = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let piece: RegExpExecArray | null;
    while ((piece = run.exec(body)) !== null) runs.push(decodeXmlEntities(piece[1] ?? ""));

    // A tab in a table cell is the only thing separating two columns once the
    // markup is gone, so it is kept.
    const text = runs.join("").replace(/<w:tab\/>/g, "\t").trim();
    if (text) out.push(text);
  }
  return out;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * One named entry out of a zip, by walking local file headers.
 *
 * The central directory would be the correct place to look, but a .docx is
 * small and written by one of about four programs, so a forward scan finds
 * word/document.xml reliably and needs no seek arithmetic. Only stored (0) and
 * deflated (8) entries are handled; nothing else appears in a .docx.
 */
async function readZipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let cursor = 0;

  while (cursor + 30 <= zip.byteLength) {
    if (view.getUint32(cursor, true) !== 0x04034b50) break;

    const method = view.getUint16(cursor + 8, true);
    const compressedSize = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);

    const nameStart = cursor + 30;
    const name = latin1(zip.slice(nameStart, nameStart + nameLength));
    const bodyStart = nameStart + nameLength + extraLength;

    if (name === wanted) {
      const body = zip.slice(bodyStart, bodyStart + compressedSize);
      if (method === 0) return body;
      if (method === 8) return (await inflateRaw(body)) ?? null;
      return null;
    }

    if (compressedSize === 0) {
      /* A streamed entry puts its size in a trailing descriptor rather than in
         the header, so there is nothing to skip by. Word does not write these
         for document.xml; giving up is better than walking off the end. */
      return null;
    }
    cursor = bodyStart + compressedSize;
  }
  return null;
}

/* ==========================================================================
   Plain text
   ========================================================================== */

async function extractPlainText(bytes: ArrayBuffer, hash: string): Promise<ExtractedDocument> {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const paragraphs = decoded
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    throw new UnreadableUploadError("There is no text in that file.");
  }

  const words = countWords(decoded);
  return {
    kind: "text",
    text: paragraphs.map((p, i) => `[¶${i + 1}] ${p}`).join("\n\n"),
    anchorKind: "paragraph",
    anchors: paragraphs.map((_, i) => `¶${i + 1}`),
    wordCount: words,
    warnings:
      words < THIN_DOCUMENT_WORDS
        ? [`Only about ${words} words were submitted, which is short for a full report.`]
        : [],
    needsVisualReader: false,
    hash,
    byteLength: bytes.byteLength,
  };
}

/* ==========================================================================
   Shared helpers
   ========================================================================== */

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bytes as characters, one for one. Not a text decode — a byte view. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** UTF-8, for content we know is XML. */
function latin1Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function inflate(body: Uint8Array): Promise<Uint8Array | null> {
  return decompress(body, "deflate");
}

async function inflateRaw(body: Uint8Array): Promise<Uint8Array | null> {
  return decompress(body, "deflate-raw");
}

/**
 * DecompressionStream, which exists in Node, on Workers and in browsers.
 *
 * Returns null rather than throwing on malformed input: a PDF with one corrupt
 * stream should lose that stream, not the whole extraction.
 */
async function decompress(
  body: Uint8Array,
  format: "deflate" | "deflate-raw",
): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}
