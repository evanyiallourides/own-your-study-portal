import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { demoState, refreshDemoClock } from "@/lib/data/demo-store";
import { joinWindow } from "@/lib/meetings/window";

/* The demo dataset resolves its relative dates once, when the module is first
   evaluated, and the state is then pinned to globalThis. Left alone it decays:
   a lesson seeded as "today" becomes yesterday's, drops out of every "today"
   query, and the dashboard it was there to populate quietly empties — with
   nothing erroring to say so. This is the guard against that.

   The state is a module singleton, so this lives in its own file. `node --test`
   runs each file in its own process, which keeps the mutation here from
   reaching the access tests. */

const dayOf = (iso: string) => iso.slice(0, 10);

describe("refreshDemoClock", () => {
  it("keeps the always-live lesson inside its own join window", () => {
    refreshDemoClock();

    const live = demoState.lessons.find((l) => l.id === "l-chem-live");
    assert.ok(live, "the demo should carry a lesson that is always in progress");

    const gate = joinWindow(live);
    assert.equal(gate.state, "open");
    assert.equal(gate.inProgress, true);
  });

  it("carries the whole dataset forward when the calendar day turns over", () => {
    refreshDemoClock();

    const lesson = demoState.lessons.find((l) => l.id === "l-alevel-3")!;
    const homework = demoState.homework.find((h) => h.dueAt)!;
    const notification = demoState.notifications[0]!;

    const before = {
      lesson: lesson.scheduledAt,
      homework: homework.dueAt!,
      notification: notification.createdAt,
    };

    // Pretend the process has been running since three days ago.
    const seeded = new Date(`${demoState.seededOn}T12:00:00Z`);
    seeded.setUTCDate(seeded.getUTCDate() - 3);
    demoState.seededOn = seeded.toISOString().slice(0, 10);

    refreshDemoClock();

    const shifted = (iso: string) =>
      Math.round(
        (new Date(iso).getTime() - new Date(before.lesson).getTime()) / 86_400_000,
      );

    assert.equal(shifted(lesson.scheduledAt), 3, "the lesson should move forward three days");

    /* The point of moving everything by the same amount: the arc between a
       lesson and the homework set in it has to survive the shift. */
    const gap = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();
    assert.equal(
      gap(homework.dueAt!, before.homework),
      gap(lesson.scheduledAt, before.lesson),
      "homework should move by exactly as much as the lessons",
    );
    assert.equal(
      gap(notification.createdAt, before.notification),
      gap(lesson.scheduledAt, before.lesson),
      "notifications should move by exactly as much as the lessons",
    );
  });

  it("records the day it last anchored to, so the shift happens once", () => {
    refreshDemoClock();
    const settled = demoState.seededOn;
    const lesson = demoState.lessons.find((l) => l.id === "l-alevel-3")!;
    const before = lesson.scheduledAt;

    refreshDemoClock();
    refreshDemoClock();

    assert.equal(demoState.seededOn, settled);
    assert.equal(
      dayOf(lesson.scheduledAt),
      dayOf(before),
      "a second call on the same day must not move anything again",
    );
  });
});
