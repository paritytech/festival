/**
 * Live Festival event watcher — `Revive.ContractEmitted` over the host-routed
 * PAPI client, via the unsafe API (no descriptors bundled). Emissions are
 * filtered to our Festival address and classified by `topics[0]`; the payload
 * is never decoded.
 *
 * Live on Android/Desktop (connection stays alive in-chat); silent on iOS (the
 * host suspends the connection while the chat is open) — the catch-up-on-open
 * read carries iOS. Shipped everywhere behind one teardown-safe subscription.
 *
 * Teardown-before-resubscribe + a 10s retry backoff keep us from leaking
 * `chainHead_v1_follow`s into the host's follow budget when the connection flaps.
 */

import { getClient } from "./chain";
import { FESTIVAL_ADDRESS } from "./config";
import { classifyTopic, type EventKind } from "./events";

const TAG = "[w3s-announcements]";
const RETRY_MS = 10_000;

interface Subscription {
  unsubscribe(): void;
}

let subscription: Subscription | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
let onEventCb: ((kind: EventKind) => void) | null = null;

/** Start (or restart) the watcher. Idempotent — a second call is a no-op. */
export function startWatcher(onEvent: (kind: EventKind) => void): void {
  onEventCb = onEvent;
  if (!stopped && subscription) return;
  stopped = false;
  subscribe();
}

/** Stop the watcher and release its chainHead follow. */
export function stopWatcher(): void {
  stopped = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  teardown();
  onEventCb = null;
}

export function isWatching(): boolean {
  return !stopped;
}

function teardown(): void {
  if (subscription) {
    try {
      subscription.unsubscribe();
    } catch (err) {
      console.warn(TAG, "watcher unsubscribe threw", err);
    }
    subscription = null;
  }
}

function scheduleRetry(): void {
  subscription = null;
  if (stopped) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(subscribe, RETRY_MS);
}

function subscribe(): void {
  if (stopped) return;
  // Drop any prior follow before opening a new one (covers the retry path).
  teardown();
  const target = FESTIVAL_ADDRESS.toLowerCase();
  try {
    subscription = getClient()
      .getUnsafeApi()
      .event.Revive.ContractEmitted.watchBest()
      .subscribe({
        next: (emission: { type: string; events?: unknown[] }) => {
          if (emission.type !== "new" || !emission.events?.length) return;
          for (const ev of emission.events) handleEvent(ev, target);
        },
        error: (err: { message?: string }) => {
          console.warn(TAG, `watcher error — resubscribe in ${RETRY_MS}ms:`, err?.message ?? err);
          scheduleRetry();
        },
      });
  } catch (err) {
    console.warn(TAG, "watcher subscribe threw", err);
    scheduleRetry();
  }
}

/** Unsafe-API payload: `{ contract, topics, data }` (hex strings + bytes). */
function handleEvent(ev: unknown, target: string): void {
  const body = (ev as { payload?: unknown })?.payload ?? ev;
  const e = body as { contract?: string; topics?: string[] };
  if (typeof e?.contract !== "string") return;
  if (e.contract.toLowerCase() !== target) return;
  const topic0 = e.topics?.[0];
  if (typeof topic0 !== "string") return;
  const kind = classifyTopic(topic0);
  if (kind) onEventCb?.(kind);
}
