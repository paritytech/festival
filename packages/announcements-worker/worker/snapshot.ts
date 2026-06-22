/**
 * Snapshot-first card data (stale-while-revalidate).
 *
 * The host pauses the worker's connections while the user sits in the chat
 * screen — exactly when cards render — so a live read at render time can hang.
 * Renders serve the persisted snapshot instantly (even stale) and refresh in
 * the background whenever the connection is alive.
 */

import { hostLocalStorage } from "@novasamatech/host-api-wrapper";
import { buildSnapshot, CARD_SNAPSHOT_VERSION, type CardSnapshot } from "./data";
import { withTimeout } from "./time";

const TAG = "[w3s-announcements]";
const SNAPSHOT_KEY = "festival-announcements:card-snapshot";
const FRESH_MS = 30_000;
const BUILD_TIMEOUT_MS = 20_000;

let current: CardSnapshot | null = null;
let inflight: Promise<CardSnapshot> | null = null;

function isSnapshot(value: unknown): value is CardSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as CardSnapshot;
  return (
    s.version === CARD_SNAPSHOT_VERSION &&
    typeof s.at === "number" &&
    typeof s.festivalName === "string" &&
    Array.isArray(s.talks) &&
    Array.isArray(s.sessions) &&
    Array.isArray(s.activations) &&
    Array.isArray(s.announcements)
  );
}

/**
 * Rebuild + persist, deduped via `inflight`. The timeout keeps a paused
 * connection from pinning `inflight` forever (which would block later refreshes).
 */
export function refreshCardData(): Promise<CardSnapshot> {
  if (!inflight) {
    inflight = withTimeout(buildSnapshot(), BUILD_TIMEOUT_MS, "snapshot build")
      .then((snapshot) => {
        current = snapshot;
        void hostLocalStorage.writeJSON(SNAPSHOT_KEY, snapshot).catch((err) => {
          console.warn(TAG, "snapshot persist failed", err);
        });
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * In-memory snapshot if resolved, else null. Lets the renderer paint real
 * content immediately on a warm cache instead of flashing a skeleton. Does NOT
 * read storage — synchronous by design.
 */
export function peekSnapshot(): CardSnapshot | null {
  return current;
}

/**
 * Snapshot for rendering: memory → storage → live build (first run only). A
 * stale hit is returned immediately and refreshed in the background.
 */
export async function getCardData(): Promise<CardSnapshot> {
  if (!current) {
    try {
      const stored = await hostLocalStorage.readJSON(SNAPSHOT_KEY);
      if (isSnapshot(stored)) current = stored;
    } catch {
      // fall through to a live build
    }
  }
  if (current) {
    if (Date.now() - current.at > FRESH_MS) {
      void refreshCardData().catch(() => {});
    }
    return current;
  }
  return refreshCardData();
}
