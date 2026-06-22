import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type ScheduleEntry } from "./config";
import {
  activationsFrom,
  announcementItemFrom,
  talksFrom,
  timeWindowItems,
  toScheduleItem,
  upcomingItems,
} from "./items";
import { fmtAnnouncementTime, parseComposer, parseTimeQuery } from "./time";

describe("parseTimeQuery", () => {
  const cases: [string, number | null][] = [
    ["what happens at 14:00", 14 * 60],
    ["15.30", 15 * 60 + 30],
    ["3pm", 15 * 60],
    ["2 pm", 14 * 60],
    ["12am", 0],
    ["around 9", 9 * 60],
    ["99 luftballons", null],
    ["nothing here", null],
  ];
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(parseTimeQuery(input), expected);
    });
  }
});

describe("parseComposer", () => {
  it("routes intents", () => {
    assert.deepEqual(parseComposer("what happens at 14:00"), { kind: "timeQuery", min: 840 });
    assert.deepEqual(parseComposer("see 3 more"), { kind: "more" });
    assert.deepEqual(parseComposer("what's new?"), { kind: "announcements" });
    assert.deepEqual(parseComposer("any workshops today?"), { kind: "sessions" });
    assert.deepEqual(parseComposer("when is the keynote"), { kind: "talks" });
    assert.deepEqual(parseComposer("how does this work"), { kind: "fallback" });
    assert.deepEqual(parseComposer("xyzzy"), { kind: "fallback" });
  });
});

describe("fmtAnnouncementTime", () => {
  const now = new Date(2026, 5, 11, 12, 0); // Thu 11 Jun 2026 local
  it("labels today / yesterday / older", () => {
    assert.equal(fmtAnnouncementTime(new Date(2026, 5, 11, 9, 12).getTime(), now), "Today · 09:12");
    assert.equal(
      fmtAnnouncementTime(new Date(2026, 5, 10, 17, 45).getTime(), now),
      "Yesterday · 17:45",
    );
    assert.ok(fmtAnnouncementTime(new Date(2026, 5, 1, 8, 0).getTime(), now).includes("· 08:00"));
    assert.equal(fmtAnnouncementTime(Number.NaN, now), "");
  });
});

describe("announcementItemFrom", () => {
  it("falls back to Organizers for a missing sender", () => {
    const item = announcementItemFrom("cid1", { content: "hi", timestamp: Date.now() });
    assert.equal(item.sender, "Organizers");
    assert.equal(item.id, "cid1");
  });
});

describe("talksFrom", () => {
  const entry = (id: string, start: string, end: string, marker?: string): ScheduleEntry => ({
    id,
    start,
    end,
    title: `Talk ${id}`,
    speakers: ["Ada"],
    venueMarkerId: marker,
  });
  const festival = {
    name: "Fest",
    markerLabels: new Map([["m1", "Main Stage"]]),
    schedule: [
      entry("past", "2026-06-10T10:00:00", "2026-06-10T11:00:00"),
      entry("soon", "2026-06-11T14:00:00", "2026-06-11T15:00:00", "m1"),
      entry("later", "2026-06-11T16:00:00", "2026-06-11T17:00:00"),
    ],
  };

  it("returns all entries sorted and resolves room labels", () => {
    const items = talksFrom(festival);
    assert.deepEqual(
      items.map((i) => i.id),
      ["past", "soon", "later"],
    );
    assert.ok(items[1].meta.includes("Main Stage"));
    assert.equal(items[2].meta, "Ada");
  });

  it("upcomingItems filters at render time, keeping all when everything is past", () => {
    const items = talksFrom(festival);
    assert.deepEqual(
      upcomingItems(items, new Date(2026, 5, 11, 12, 0).getTime()).map((i) => i.id),
      ["soon", "later"],
    );
    assert.equal(upcomingItems(items, new Date(2027, 0, 1).getTime()).length, 3);
  });

  it("excludes activations (all-day programming, any location)", () => {
    const items = talksFrom({
      ...festival,
      schedule: [
        ...festival.schedule,
        {
          // Runs all day, and where it happens doesn't matter. Activations are
          // filtered out by category, never by location.
          ...entry("allday", "2026-06-11T09:00:00", "2026-06-11T20:00:00"),
          category: "activations",
        },
      ],
    });
    assert.deepEqual(
      items.map((i) => i.id),
      ["past", "soon", "later"],
    );
  });
});

describe("activationsFrom", () => {
  const entry = (id: string, start: string, end: string): ScheduleEntry => ({
    id,
    start,
    end,
    title: `Activation ${id}`,
    speakers: ["Ada"],
  });
  const festival = {
    name: "Fest",
    markerLabels: new Map<string, string>(),
    schedule: [
      { ...entry("a-late", "2026-06-12T09:00:00", "2026-06-12T20:00:00"), category: "activations" as const },
      { ...entry("a-early", "2026-06-10T09:00:00", "2026-06-10T20:00:00"), category: "activations" as const },
      entry("talk", "2026-06-11T14:00:00", "2026-06-11T15:00:00"),
    ],
  };

  it("keeps only activations, sorted by start, with kindLabel 'Activation'", () => {
    const items = activationsFrom(festival);
    assert.deepEqual(
      items.map((i) => i.id),
      ["a-early", "a-late"],
    );
    assert.ok(items.every((i) => i.kindLabel === "Activation"));
  });
});

describe("timeWindowItems", () => {
  const at = (id: string, startMin: number) => ({
    ...toScheduleItem(
      id,
      new Date(2026, 5, 11, 0, 0),
      new Date(2026, 5, 11, 1, 0),
      id,
      [],
      undefined,
      "Talk",
    ),
    startMin,
  });

  it("merges, windows, sorts, and caps", () => {
    const talks = [at("t1", 850), at("t2", 1000)];
    const sessions = [at("s1", 845), at("s2", 880), at("s3", 905), at("s4", 910)];
    const out = timeWindowItems(talks, sessions, 840, 75, 4);
    assert.deepEqual(
      out.map((i) => i.id),
      ["s1", "t1", "s2", "s3"],
    );
  });
});
