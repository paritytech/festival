import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EVENT_TOPIC, classifyTopic } from "./events";

describe("classifyTopic", () => {
  it("maps each known topic0 to its snapshot slice", () => {
    assert.equal(classifyTopic(EVENT_TOPIC.channelMetadataUpdated), "channel");
    assert.equal(classifyTopic(EVENT_TOPIC.metadataUpdated), "festival");
    assert.equal(classifyTopic(EVENT_TOPIC.sessionCreated), "sessions");
    assert.equal(classifyTopic(EVENT_TOPIC.sessionCancelled), "sessions");
  });

  it("is case-insensitive on the hex", () => {
    assert.equal(classifyTopic(EVENT_TOPIC.channelMetadataUpdated.toUpperCase()), "channel");
  });

  it("returns null for unrelated topics (e.g. CheckedIn, Transfer)", () => {
    assert.equal(classifyTopic("0x" + "0".repeat(64)), null);
    assert.equal(classifyTopic("0xdeadbeef"), null);
    assert.equal(classifyTopic(""), null);
  });

  it("keeps all four topic0 hashes distinct and 32-byte", () => {
    const all = Object.values(EVENT_TOPIC);
    assert.equal(new Set(all).size, all.length);
    for (const t of all) assert.match(t, /^0x[0-9a-f]{64}$/);
  });
});
