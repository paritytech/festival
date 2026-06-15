import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeAddressArray, decodeEventDetails } from "./abi";

const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
const wordOf = (n: number | bigint) => pad(n.toString(16));

const ADDR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CID = "0x" + "12".repeat(32);

describe("decodeAddressArray", () => {
  it("decodes a two-element address[]", () => {
    const returndata = `0x${wordOf(0x20)}${wordOf(2)}${pad(ADDR_A)}${pad(ADDR_B)}` as const;
    assert.deepEqual(decodeAddressArray(returndata), [ADDR_A, ADDR_B]);
  });

  it("decodes an empty array", () => {
    const returndata = `0x${wordOf(0x20)}${wordOf(0)}` as const;
    assert.deepEqual(decodeAddressArray(returndata), []);
  });

  it("throws on truncated returndata", () => {
    const returndata = `0x${wordOf(0x20)}${wordOf(2)}${pad(ADDR_A)}` as const;
    assert.throws(() => decodeAddressArray(returndata));
  });
});

describe("decodeEventDetails", () => {
  it("extracts cid, times, and the cancelled flag from the 8-word tuple", () => {
    const startTime = 1_780_000_000n;
    const endTime = 1_780_003_600n;
    const returndata = `0x${[
      pad(CID), // metadataCid
      pad(ADDR_A), // creator
      pad(ADDR_B), // poapContract
      pad(ADDR_A), // parentFestival
      wordOf(startTime),
      wordOf(endTime),
      wordOf(1), // cancelled
      wordOf(42), // registeredCount
    ].join("")}` as const;

    const session = decodeEventDetails(ADDR_B, returndata);
    assert.equal(session.address, ADDR_B);
    assert.equal(session.metadataCid, CID);
    assert.equal(session.startTime, Number(startTime));
    assert.equal(session.endTime, Number(endTime));
    assert.equal(session.cancelled, true);
  });

  it("throws on short returndata", () => {
    assert.throws(() => decodeEventDetails(ADDR_A, `0x${pad(CID)}`));
  });
});
