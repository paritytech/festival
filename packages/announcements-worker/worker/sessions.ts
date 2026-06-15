/** On-chain FestivalSession reads: raw selectors + the pure decoders in abi.ts. */

import { decodeAddressArray, decodeEventDetails, type OnChainSession } from "./abi";
import { readCall } from "./chain";
import { FESTIVAL_ADDRESS } from "./config";

/** keccak256("<sig>")[:4], same derivation as chain.ts's SELECTOR table. */
const SELECTOR = {
  getSessions: "0x61503e45",
  getEventDetails: "0xe2bb3ccf",
} as const;

export type { OnChainSession };

const TAG = "[w3s-announcements]";

/** All non-cancelled sessions of the festival, one dry-run per session. */
export async function readSessions(): Promise<OnChainSession[]> {
  const raw = await readCall(FESTIVAL_ADDRESS, SELECTOR.getSessions, "getSessions");
  const addresses = decodeAddressArray(raw);
  if (addresses.length === 0) return [];

  // One bad/cancelled session must not drop the rest.
  const results = await Promise.all(
    addresses.map(async (addr) => {
      try {
        const data = await readCall(addr, SELECTOR.getEventDetails, "getEventDetails");
        return decodeEventDetails(addr, data);
      } catch (err) {
        console.warn(TAG, "session getEventDetails failed", addr, err);
        return null;
      }
    }),
  );
  return results.filter((s): s is OnChainSession => s !== null && !s.cancelled);
}
