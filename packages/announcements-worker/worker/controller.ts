/**
 * Card controller — payload codec, per-message render state, action routing.
 *
 * Each card is a `Custom { messageType: 'card', payload }` message with a
 * JSON payload discriminated by `kind`. On a render request the controller
 * resolves the card's data (snapshot-first; see snapshot.ts) and renders the
 * tree; button actions arrive via the render session's `subscribeActions` (the
 * cross-host-portable path) and re-render the same message in place.
 *
 * Per-message UI state (paging) lives in memory and resets with the worker.
 * Deeplinks (`open:map` / `open:schedule`) are posted as chat messages, not
 * `navigateTo` — a link preview routes with the page, while `navigateTo` from a
 * card button drops the route on iOS and is blocked entirely on Android.
 */

import { type ChatCustomMessageRenderer } from "@novasamatech/host-api-wrapper";
import {
  type AnnouncementItem,
  announcementPostCard,
  announcementsCard,
  type CardState,
  errorCard,
  initialCardState,
  loadingCard,
  PAGE_SIZE,
  type ScheduleItem,
  scheduleCard,
  TIME_WINDOW_MIN,
  timeQueryCard,
  welcomeCard,
} from "./cards";
import { type AnnouncementBody, spaDeeplink } from "./config";
import { announcementItemFrom, timeWindowItems, upcomingItems } from "./items";
import { type Node } from "./nodes";
import { getCardData, peekSnapshot } from "./snapshot";
import { withTimeout } from "./time";

const TAG = "[w3s-announcements]";

/** Attendee SPA hash routes. */
const SCHEDULE_PATH = "/#/program";
const MAP_PATH = "/#/map";

export const CARD_MESSAGE_TYPE = "card";

export type CardKind = "welcome" | "announcements" | "talks" | "sessions" | "activations";

export type CardPayload =
  | { kind: CardKind }
  | { kind: "timeQuery"; min: number }
  | { kind: "announcement"; cid: string; body: AnnouncementBody };

export function encodeCardPayload(payload: CardPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodeCardPayload(bytes: Uint8Array): CardPayload | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as CardPayload;
    return typeof parsed === "object" && parsed !== null && "kind" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Outer guard on data resolution. Snapshot hits resolve instantly; this only
 * bites on a first-ever run with no persisted snapshot, where the live build
 * can hang on a paused connection.
 */
const LOAD_TIMEOUT_MS = 12_000;

type ResolvedData =
  | { kind: "welcome"; festivalName: string; subscribed: boolean }
  | { kind: "announcements"; items: AnnouncementItem[]; festivalName: string }
  | { kind: "talks" | "sessions" | "activations"; items: ScheduleItem[] }
  | { kind: "timeQuery"; min: number; items: ScheduleItem[] }
  | { kind: "announcement"; item: AnnouncementItem };

export interface CardController {
  renderer: ChatCustomMessageRenderer;
  /** Pre-seed a freshly posted schedule card's page (typed "see more" flow). */
  seedPage(messageId: string, page: number): void;
  /** Last schedule card the user saw — kind + current page. */
  lastSchedule(): { kind: "talks" | "sessions" | "activations"; page: number } | null;
}

export function createCardController(deps: {
  launchCard: (payload: CardPayload) => void;
  sendText: (text: string) => void;
  /** Current "Keep me posted" state (sync mirror of hostLocalStorage). */
  broadcastsOn: () => boolean;
  /** Flip the toggle: persists, (re)starts/stops the watcher, sets the baseline. */
  setBroadcasts: (on: boolean) => void;
  /** Chat (re)opened — refresh the snapshot and run catch-up. Debounced by index. */
  onResume: () => void;
}): CardController {
  const states = new Map<string, CardState>();
  let lastSchedule: { kind: "talks" | "sessions" | "activations"; page: number } | null = null;

  function getState(messageId: string): CardState {
    let state = states.get(messageId);
    if (!state) {
      state = initialCardState();
      states.set(messageId, state);
    }
    return state;
  }

  function openLink(hashPath: string, prompt: string): void {
    const url = spaDeeplink(hashPath);
    if (!url) {
      console.warn(TAG, "no festival dotNS configured — cannot post link", hashPath);
      return;
    }
    deps.sendText(`${prompt}\n${url}`);
  }

  async function resolve(payload: CardPayload): Promise<ResolvedData> {
    // The announcement card carries its own body — no I/O.
    if (payload.kind === "announcement") {
      return { kind: "announcement", item: announcementItemFrom(payload.cid, payload.body) };
    }

    const snapshot = await getCardData();
    switch (payload.kind) {
      case "welcome":
        return {
          kind: "welcome",
          festivalName: snapshot.festivalName,
          subscribed: deps.broadcastsOn(),
        };
      case "announcements":
        return {
          kind: "announcements",
          items: snapshot.announcements,
          festivalName: snapshot.festivalName,
        };
      case "talks":
        return { kind: "talks", items: upcomingItems(snapshot.talks) };
      case "sessions":
        return { kind: "sessions", items: upcomingItems(snapshot.sessions) };
      case "activations":
        return { kind: "activations", items: upcomingItems(snapshot.activations) };
      case "timeQuery":
        return {
          kind: "timeQuery",
          min: payload.min,
          items: timeWindowItems(snapshot.talks, snapshot.sessions, payload.min, TIME_WINDOW_MIN),
        };
    }
  }

  function build(data: ResolvedData, state: CardState): Node {
    switch (data.kind) {
      case "welcome":
        return welcomeCard(data.festivalName, data.subscribed);
      case "announcements":
        return announcementsCard(data.items, data.festivalName);
      case "talks":
      case "sessions":
      case "activations": {
        const pages = Math.max(1, Math.ceil(data.items.length / PAGE_SIZE));
        state.page = ((state.page % pages) + pages) % pages;
        lastSchedule = { kind: data.kind, page: state.page };
        return scheduleCard(data.kind, data.items, state);
      }
      case "timeQuery":
        return timeQueryCard(data.min, data.items);
      case "announcement":
        return announcementPostCard(data.item);
    }
  }

  const renderer: ChatCustomMessageRenderer = (params, render) => {
    const payload = decodeCardPayload(params.payload);
    const state = getState(params.messageId);
    let disposed = false;
    let data: ResolvedData | null = null;

    function rerender(): void {
      if (disposed || !data) return;
      render(build(data, state));
    }

    async function load(): Promise<void> {
      if (!payload) return;
      // Skeleton only on a genuine cold start; a warm snapshot (or the I/O-free
      // announcement card) resolves next microtask, so a skeleton there flashes.
      const warm = payload.kind === "announcement" || peekSnapshot() !== null;
      if (!warm) render(loadingCard());
      try {
        data = await withTimeout(resolve(payload), LOAD_TIMEOUT_MS, payload.kind);
        rerender();
      } catch (err) {
        console.warn(TAG, "card data load failed", payload.kind, err);
        if (!disposed) render(errorCard("Couldn’t load this card."));
      }
    }

    function onAction(actionId: string): void {
      // Split on the FIRST ":" only — an arg (e.g. a deeplink id) may contain colons.
      const sep = actionId.indexOf(":");
      const verb = sep === -1 ? actionId : actionId.slice(0, sep);
      const arg = sep === -1 ? undefined : actionId.slice(sep + 1);
      if (verb === "retry") {
        void load();
        return;
      }
      if (verb === "qa") {
        if (
          arg === "announcements" ||
          arg === "talks" ||
          arg === "sessions" ||
          arg === "activations"
        ) {
          deps.launchCard({ kind: arg });
        }
        return;
      }
      if (verb === "open") {
        if (arg === "map") openLink(MAP_PATH, "Open the venue map:");
        else openLink(SCHEDULE_PATH, "Open the full schedule:");
        return;
      }
      if (verb === "sub") {
        deps.setBroadcasts(arg === "on");
        if (data?.kind === "welcome") data.subscribed = deps.broadcastsOn();
        rerender();
        return;
      }
      if (!data) return;
      if (verb === "more") {
        state.page += 1;
        rerender();
      } else if (verb === "restart") {
        state.page = 0;
        rerender();
      }
    }

    const unsubscribe = params.subscribeActions((actionId) => onAction(actionId));
    // A render request means the chat is open and the connection is (briefly)
    // alive — the worker's "resumed" signal.
    deps.onResume();
    void load();

    return () => {
      disposed = true;
      unsubscribe();
      states.delete(params.messageId);
    };
  };

  return {
    renderer,
    seedPage(messageId, page) {
      getState(messageId).page = page;
    },
    lastSchedule: () => lastSchedule,
  };
}
