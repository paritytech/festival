/** Pure ABI word-slicing for the two session read shapes — no viem, unit-tested. */

export interface OnChainSession {
  address: `0x${string}`;
  metadataCid: `0x${string}`;
  /** Unix seconds. */
  startTime: number;
  endTime: number;
  cancelled: boolean;
}

/** i-th 32-byte word of ABI returndata as a 64-char hex string (no 0x). */
function word(returndata: `0x${string}`, i: number): string {
  const start = 2 + i * 64;
  const slice = returndata.slice(start, start + 64);
  if (slice.length !== 64) throw new Error(`returndata too short for word ${i}`);
  return slice;
}

/** Decode `address[]`: offset word, length word, then right-aligned addresses. */
export function decodeAddressArray(returndata: `0x${string}`): `0x${string}`[] {
  const length = Number(BigInt(`0x${word(returndata, 1)}`));
  const out: `0x${string}`[] = [];
  for (let i = 0; i < length; i++) {
    out.push(`0x${word(returndata, 2 + i).slice(24)}`);
  }
  return out;
}

/**
 * Decode `getEventDetails()` — a fixed 8-word tuple (metadataCid, creator,
 * poapContract, parentFestival, startTime, endTime, cancelled, registeredCount).
 * Only the card-relevant words are kept.
 */
export function decodeEventDetails(
  address: `0x${string}`,
  returndata: `0x${string}`,
): OnChainSession {
  return {
    address,
    metadataCid: `0x${word(returndata, 0)}`,
    startTime: Number(BigInt(`0x${word(returndata, 4)}`)),
    endTime: Number(BigInt(`0x${word(returndata, 5)}`)),
    cancelled: BigInt(`0x${word(returndata, 6)}`) !== 0n,
  };
}
