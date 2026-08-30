import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMeetingLink, isUsableMeetingLink } from "@/lib/meetings/links";
import { joinWindow, untilOpenLabel } from "@/lib/meetings/window";

/* Meeting links arrive pasted by hand, so the parser is the part most exposed
   to real-world mess. The join window decides whether a link is offered at
   all, so both are pure and tested directly. */

describe("parseMeetingLink", () => {
  it("recognises a Google Meet link and reads the code", () => {
    const link = parseMeetingLink("https://meet.google.com/abc-defg-hij");
    assert.equal(link?.platform, "google_meet");
    assert.equal(link?.code, "abc-defg-hij");
    assert.equal(link?.label, "Google Meet");
  });

  it("accepts a bare Meet code, which is what people copy from a calendar", () => {
    const link = parseMeetingLink("abc-defg-hij");
    assert.equal(link?.platform, "google_meet");
    assert.equal(link?.url, "https://meet.google.com/abc-defg-hij");
  });

  it("accepts a link with no scheme", () => {
    const link = parseMeetingLink("meet.google.com/abc-defg-hij");
    assert.equal(link?.url, "https://meet.google.com/abc-defg-hij");
  });

  it("does not present a Meet nickname as a code", () => {
    const link = parseMeetingLink("https://meet.google.com/lookup/chemistrytuesday");
    assert.equal(link?.platform, "google_meet");
    assert.equal(link?.code, null);
  });

  it("strips tracking parameters but keeps Zoom's passcode", () => {
    const link = parseMeetingLink(
      "https://us02web.zoom.us/j/81234567890?pwd=Sk9uZXM&utm_source=calendar",
    );
    assert.equal(link?.platform, "zoom");
    assert.ok(link?.url.includes("pwd=Sk9uZXM"));
    assert.ok(!link?.url.includes("utm_source"));
    assert.equal(link?.passcodeInUrl, true);
  });

  it("formats a Zoom meeting id the way Zoom shows it", () => {
    assert.equal(parseMeetingLink("https://zoom.us/j/81234567890")?.code, "812 3456 7890");
  });

  it("recognises Teams", () => {
    const link = parseMeetingLink(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d",
    );
    assert.equal(link?.platform, "teams");
    assert.equal(link?.label, "Microsoft Teams");
  });

  it("unwraps a calendar redirector", () => {
    const link = parseMeetingLink(
      "https://www.google.com/url?q=https://meet.google.com/abc-defg-hij&sa=D",
    );
    assert.equal(link?.platform, "google_meet");
    assert.equal(link?.code, "abc-defg-hij");
  });

  it("keeps an unknown provider rather than rejecting it", () => {
    const link = parseMeetingLink("https://vc.school.edu/room/7781");
    assert.equal(link?.platform, "other");
    assert.equal(link?.label, "vc.school.edu");
  });

  it("rejects what is not a link at all", () => {
    for (const bad of ["", "   ", "ask your tutor", "javascript:alert(1)", "localhost"]) {
      assert.equal(parseMeetingLink(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
    assert.equal(isUsableMeetingLink(null), false);
  });
});

describe("joinWindow", () => {
  const at = (iso: string) => new Date(iso);
  const lesson = {
    scheduledAt: "2026-09-01T16:00:00.000Z",
    durationMinutes: 60,
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    status: "scheduled" as const,
  };

  it("is closed well before the lesson", () => {
    const w = joinWindow(lesson, at("2026-09-01T12:00:00.000Z"));
    assert.equal(w.state, "early");
    assert.ok(w.msUntilOpen > 0);
  });

  it("opens ten minutes before", () => {
    assert.equal(joinWindow(lesson, at("2026-09-01T15:49:00.000Z")).state, "early");
    assert.equal(joinWindow(lesson, at("2026-09-01T15:50:30.000Z")).state, "open");
  });

  it("reports in-progress only between start and end", () => {
    assert.equal(joinWindow(lesson, at("2026-09-01T15:55:00.000Z")).inProgress, false);
    assert.equal(joinWindow(lesson, at("2026-09-01T16:30:00.000Z")).inProgress, true);
    assert.equal(joinWindow(lesson, at("2026-09-01T17:10:00.000Z")).inProgress, false);
  });

  it("stays open past the scheduled end, because lessons overrun", () => {
    assert.equal(joinWindow(lesson, at("2026-09-01T17:20:00.000Z")).state, "open");
    assert.equal(joinWindow(lesson, at("2026-09-01T17:40:00.000Z")).state, "ended");
  });

  it("refuses a cancelled lesson at any time", () => {
    const w = joinWindow({ ...lesson, status: "cancelled" }, at("2026-09-01T16:10:00.000Z"));
    assert.equal(w.state, "unavailable");
  });

  it("treats a written-up lesson as over even inside the clock window", () => {
    const w = joinWindow({ ...lesson, status: "published" }, at("2026-09-01T16:10:00.000Z"));
    assert.equal(w.state, "ended");
  });

  it("says so when there is no link", () => {
    const w = joinWindow({ ...lesson, meetingUrl: null }, at("2026-09-01T16:10:00.000Z"));
    assert.equal(w.state, "no_link");
    assert.ok(w.reason);
  });
});

describe("untilOpenLabel", () => {
  it("stays coarse", () => {
    assert.equal(untilOpenLabel(30_000), "in under a minute");
    assert.equal(untilOpenLabel(4 * 60_000), "in 4 minutes");
    assert.equal(untilOpenLabel(3 * 3_600_000), "in about 3 hours");
    assert.equal(untilOpenLabel(48 * 3_600_000), "in 2 days");
  });
});
