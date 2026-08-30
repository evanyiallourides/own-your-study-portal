import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toSegments } from "@/lib/recall/client";

/* The mapping from Recall's per-word payload to the portal's turn-based
   segments is the part most likely to break when the provider changes its
   response, so it is pure and tested on its own. */

const words = (text: string, start: number) =>
  text.split(" ").map((word, i) => ({
    text: word,
    start_timestamp: { relative: start + i * 0.4 },
    end_timestamp: { relative: start + i * 0.4 + 0.35 },
  }));

describe("Recall transcript mapping", () => {
  const names = { tutorName: "Imogen Vasari", studentName: "Sophia Thompson" };

  it("labels speakers by role from the participant name", () => {
    const segments = toSegments(
      [
        { participant: { name: "Imogen Vasari" }, words: words("Why does this favour SN2", 10) },
        { participant: { name: "Sophia Thompson" }, words: words("Because the carbon is primary", 20) },
      ],
      names,
    );

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.role, "tutor");
    assert.equal(segments[1]?.role, "student");
    assert.equal(segments[1]?.text, "Because the carbon is primary");
  });

  it("treats an unknown participant as neither tutor nor student", () => {
    const segments = toSegments(
      [{ participant: { name: "Own Your Study AI Notetaker" }, words: words("Recording has started", 1) }],
      names,
    );
    assert.equal(segments[0]?.role, "other");
  });

  it("merges consecutive turns by the same speaker", () => {
    const segments = toSegments(
      [
        { participant: { name: "Imogen Vasari" }, words: words("Right then", 10) },
        { participant: { name: "Imogen Vasari" }, words: words("lets begin", 11.2) },
        { participant: { name: "Sophia Thompson" }, words: words("Okay", 20) },
      ],
      names,
    );
    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.text, "Right then lets begin");
  });

  it("does not merge across a long pause", () => {
    const segments = toSegments(
      [
        { participant: { name: "Imogen Vasari" }, words: words("Think about it", 10) },
        { participant: { name: "Imogen Vasari" }, words: words("Any thoughts", 40) },
      ],
      names,
    );
    assert.equal(segments.length, 2);
  });

  it("drops entries with no words and renumbers the rest", () => {
    const segments = toSegments(
      [
        { participant: { name: "Imogen Vasari" }, words: [] },
        { participant: { name: "Sophia Thompson" }, words: words("Yes", 5) },
      ],
      names,
    );
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.index, 0);
  });

  it("tightens spacing before punctuation", () => {
    const segments = toSegments(
      [{ participant: { name: "Sophia Thompson" }, words: words("Because it is primary .", 5) }],
      names,
    );
    assert.equal(segments[0]?.text, "Because it is primary.");
  });
});
