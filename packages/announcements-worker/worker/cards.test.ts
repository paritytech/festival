import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AnnouncementItem,
  announcementPostCard,
  announcementsCard,
  clampContent,
  errorCard,
  initialCardState,
  loadingCard,
  MAX_CONTENT,
  type ScheduleItem,
  scheduleCard,
  timeQueryCard,
  welcomeCard,
} from "./cards";
import { type Node } from "./nodes";

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  if (node.value && typeof node.value === "object" && "children" in node.value) {
    for (const child of node.value.children) walk(child, visit);
  }
}

function texts(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.tag === "String") out.push(n.value);
  });
  return out;
}

type ButtonProps = Extract<Node, { tag: "Button" }>["value"]["props"];

function buttons(node: Node): ButtonProps[] {
  const out: ButtonProps[] = [];
  walk(node, (n) => {
    if (n.tag === "Button") out.push(n.value.props);
  });
  return out;
}

const allText = (node: Node) => texts(node).join("\n");
const actions = (node: Node) => buttons(node).map((b) => b.clickAction);

function backgroundColors(node: Node): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (!n.value || typeof n.value !== "object" || !("modifiers" in n.value)) return;
    for (const m of n.value.modifiers) {
      if (m.tag === "background") out.push(m.value.color);
    }
  });
  return out;
}

const announcement = (id: string, content: string): AnnouncementItem => ({
  id,
  sender: "Summit Team",
  time: "Today · 09:12",
  content,
});

const scheduleItem = (id: string, time: string, title: string): ScheduleItem => ({
  id,
  time,
  startMs: Date.UTC(2026, 5, 11, 10, 0),
  endMs: Date.UTC(2026, 5, 11, 11, 0),
  startMin: 600,
  title,
  meta: "Speaker  ·  Main Stage",
  room: "Main Stage",
  kindLabel: "Talk",
  dateLabel: "Wed 11 Jun",
});

const SEVEN = Array.from({ length: 7 }, (_, i) => scheduleItem(`t${i + 1}`, "10:00", `Talk ${i + 1}`));

describe("clampContent", () => {
  it("keeps content within the cap as-is", () => {
    assert.equal(clampContent("short"), "short");
  });

  it("clamps overlong content at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(120).trim(); // 599 chars > MAX_CONTENT
    const out = clampContent(long);
    assert.ok(out.endsWith("…"));
    assert.ok(out.length <= MAX_CONTENT + 1);
    assert.ok(!out.includes("  "));
  });
});

describe("welcomeCard", () => {
  it("shows the festival name, four launchers, and the broadcast toggle", () => {
    const card = welcomeCard("Web3 Summit 2026", false);
    assert.ok(allText(card).includes("Web3 Summit 2026"));
    assert.deepEqual(actions(card), [
      "qa:announcements",
      "qa:talks",
      "qa:activations",
      "qa:sessions",
      "open:map",
      "sub:on",
    ]);
    assert.ok(allText(card).includes("New announcements land here."));
    assert.ok(buttons(card).some((b) => b.text === "Take me to the map"));
  });

  it("toggle reflects state: off → Keep me posted/sub:on, on → You’re in the loop/sub:off", () => {
    const off = welcomeCard("F", false);
    assert.ok(buttons(off).some((b) => b.text === "Keep me posted" && b.clickAction === "sub:on"));
    assert.ok(!actions(off).includes("sub:off"));

    const on = welcomeCard("F", true);
    assert.ok(buttons(on).some((b) => b.text === "You’re in the loop" && b.clickAction === "sub:off"));
    assert.ok(!actions(on).includes("sub:on"));
  });

  it("has no Help button", () => {
    assert.ok(!actions(welcomeCard("F", false)).includes("qa:help"));
  });

  it("frames each pill with an fg.primary box and emoji-free labels", () => {
    const card = welcomeCard("F", false);
    for (const b of buttons(card)) {
      assert.equal(b.variant, "primary");
      assert.match(b.text, /^[A-Za-z]/);
    }
    assert.ok(backgroundColors(card).includes("fg.primary"));
  });
});

describe("announcementsCard", () => {
  it("renders every item with From: sender + time + full content, no buttons", () => {
    const card = announcementsCard(
      [announcement("a1", "doors open"), announcement("a2", "wifi is live")],
      "Fest",
    );
    const t = allText(card);
    assert.ok(t.includes("2 latest · Fest"));
    assert.ok(t.includes("From: Summit Team"));
    assert.ok(t.includes("doors open") && t.includes("wifi is live"));
    assert.equal(buttons(card).length, 0);
  });

  it("shows full (uncapped-length) content without a Show more control", () => {
    const card = announcementsCard([announcement("a1", "a fairly long sentence that stays whole")], "F");
    assert.ok(allText(card).includes("a fairly long sentence that stays whole"));
    assert.equal(buttons(card).length, 0);
  });

  it("shows the empty message when there are no announcements", () => {
    const card = announcementsCard([], "Fest");
    assert.ok(allText(card).includes("No announcements"));
  });
});

describe("announcementPostCard", () => {
  it("renders sender, time, and content with no buttons", () => {
    const card = announcementPostCard(announcement("a1", "doors open"));
    const t = allText(card);
    assert.ok(t.includes("From: Summit Team") && t.includes("Today · 09:12") && t.includes("doors open"));
    assert.equal(buttons(card).length, 0);
  });
});

describe("scheduleCard", () => {
  it("rich rows are not tappable; only the footer pills are buttons", () => {
    const card = scheduleCard("talks", SEVEN.slice(0, 3), initialCardState());
    assert.deepEqual(actions(card), ["open:schedule"]);
    assert.ok(allText(card).includes("Talk 1"));
    assert.ok(buttons(card).some((b) => b.text === "Open schedule"));
  });

  it("forward-only paging: See N more on early pages, Start over at the end", () => {
    const p0 = scheduleCard("talks", SEVEN, initialCardState());
    assert.ok(allText(p0).includes("Showing 1–3 of 7"));
    const a0 = actions(p0);
    assert.ok(a0.includes("more") && a0.includes("open:schedule"));
    assert.ok(!a0.includes("restart") && !a0.includes("back"));

    const last = scheduleCard("talks", SEVEN, { page: 2 });
    assert.ok(allText(last).includes("Showing 7–7 of 7"));
    const aLast = actions(last);
    assert.ok(aLast.includes("restart") && aLast.includes("open:schedule"));
    assert.ok(!aLast.includes("more"));
  });

  it("community sessions card is titled and opens the schedule", () => {
    const card = scheduleCard("sessions", SEVEN.slice(0, 2), initialCardState());
    assert.ok(allText(card).includes("Community sessions"));
    assert.ok(actions(card).includes("open:schedule"));
    assert.ok(buttons(card).some((b) => b.text === "Open schedule"));
  });

  it("empty state still offers the Open schedule CTA", () => {
    const card = scheduleCard("sessions", [], initialCardState());
    assert.ok(allText(card).includes("No community sessions"));
    assert.deepEqual(actions(card), ["open:schedule"]);
  });
});

describe("timeQueryCard", () => {
  it("lists matching items (not tappable) with one Open schedule CTA", () => {
    const card = timeQueryCard(845, SEVEN.slice(0, 2));
    const t = allText(card);
    assert.ok(t.includes("Around 14:05"));
    assert.ok(t.includes("2 on now & next"));
    assert.deepEqual(actions(card), ["open:schedule"]);
  });

  it("offers upcoming talks when the window is empty", () => {
    const card = timeQueryCard(845, []);
    assert.ok(allText(card).includes("Nothing scheduled"));
    assert.equal(buttons(card)[0].clickAction, "qa:talks");
  });
});

describe("static cards", () => {
  it("errorCard carries the message and a retry action", () => {
    const card = errorCard("boom");
    assert.ok(allText(card).includes("boom"));
    assert.equal(buttons(card)[0].clickAction, "retry");
  });

  it("loadingCard has no interactive nodes", () => {
    assert.equal(buttons(loadingCard()).length, 0);
  });
});
