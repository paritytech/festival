/**
 * Festival Announcements — Polkadot chat extension (worker entry).
 *
 * The worker modality of the festival product. It renders interactive cards in
 * the host chat, routes user text (slash commands + free-text intents) to cards,
 * and — behind one opt-in toggle — broadcasts new on-chain announcements as they
 * land. All reads are host-routed (see chain.ts). No host emits Command actions
 * or intercepts "/", so commands are parsed out of plain Text here.
 */

import {
  createProductChatManager,
  hostLocalStorage,
  matchChatCustomRenderers,
} from "@novasamatech/host-api-wrapper";
import {
  type AnnouncementBody,
  BOT_ID,
  BOT_NAME,
  BROADCASTS_KEY,
  type ChannelMetadata,
  ROOM_ID,
  SEEN_CIDS_KEY,
} from "./config";
import { bytes32ToCid, isZeroCid, readChannelMetadataCid, retrieveJson } from "./chain";
import {
  CARD_MESSAGE_TYPE,
  type CardKind,
  type CardPayload,
  createCardController,
  encodeCardPayload,
} from "./controller";
import { type EventKind } from "./events";
import { refreshCardData } from "./snapshot";
import { startWatcher, stopWatcher } from "./watcher";
import { parseComposer, parseTimeQuery, withTimeout } from "./time";

const TAG = "[w3s-announcements]";
console.log(TAG, "worker loaded");

const chat = createProductChatManager();

async function postCard(payload: CardPayload): Promise<string | null> {
  try {
    const { messageId } = await chat.sendMessage(ROOM_ID, {
      tag: "Custom",
      value: { messageType: CARD_MESSAGE_TYPE, payload: encodeCardPayload(payload) },
    });
    return messageId;
  } catch (err) {
    console.error(TAG, "postCard failed", payload.kind, err);
    return null;
  }
}

const controller = createCardController({
  launchCard: (payload) => void postCard(payload),
  sendText: (text) => void safeSend(text),
  broadcastsOn: () => broadcastsOn,
  setBroadcasts,
  onResume,
});

chat.onCustomMessageRenderingRequest(
  matchChatCustomRenderers({ [CARD_MESSAGE_TYPE]: controller.renderer }),
);

// 1. Register bot (fire-and-forget; idempotent).
chat
  .registerBot({ botId: BOT_ID, name: BOT_NAME, icon: "" })
  .then((status) => console.log(TAG, "registerBot", status))
  .catch((err) => console.error(TAG, "registerBot failed", err));

// 2. Register room, boot the broadcast machinery, then welcome on first creation.
chat
  .registerRoom({ roomId: ROOM_ID, name: BOT_NAME, icon: "" })
  .then(async (status) => {
    console.log(TAG, "registerRoom", status);
    await boot();
    if (status === "New") await postCard({ kind: "welcome" });
  })
  .catch((err) => console.error(TAG, "registerRoom failed", err));

// 3. Incoming user text → intents.
chat.subscribeAction((action) => {
  if (action.payload.tag !== "MessagePosted") return;
  if (action.roomId !== ROOM_ID) return;
  if (action.payload.value.tag !== "Text") return;
  void handleText(action.payload.value.value.trim());
});

const SLASH_CARD: Record<string, CardKind> = {
  announcements: "announcements",
  agenda: "talks",
  talks: "talks",
  sessions: "sessions",
};

/** On-theme replies for input we can't route, then the menu re-appears. */
const ROASTS = [
  "Decentralized I am, but a mind-reader I am not. Try one of these:",
  "Not your keys, not your command. I don’t hold that one, pick from the menu:",
  "I ran that through zero-knowledge and proved exactly nothing. Here’s what I do know:",
  "Sovereign individuals still need a valid input. Here are your options:",
  "Couldn’t reach consensus on what you meant. Forking to the menu:",
  "Cypherpunks write code; I read commands. Here’s the set I accept:",
];
let roastIndex = 0;
function nextRoast(): string {
  const line = ROASTS[roastIndex % ROASTS.length];
  roastIndex += 1;
  return line;
}

async function handleText(text: string): Promise<void> {
  if (!text) return;

  if (text.startsWith("/") || text.startsWith("!")) {
    const command = text.slice(1).trimStart().split(/\s+/)[0]?.toLowerCase() ?? "";
    const match = Object.keys(SLASH_CARD).find((k) => k.startsWith(command) && command !== "");
    if (match) {
      await postCard({ kind: SLASH_CARD[match] });
    } else {
      const min = parseTimeQuery(text);
      if (min != null) await postCard({ kind: "timeQuery", min });
      else await fallback();
    }
    return;
  }

  const intent = parseComposer(text);
  if (intent.kind === "timeQuery") {
    await postCard({ kind: "timeQuery", min: intent.min });
  } else if (intent.kind === "more") {
    // Typed "see more": continue the last schedule card on a fresh message.
    const last = controller.lastSchedule();
    const id = await postCard({ kind: last?.kind ?? "talks" });
    if (id && last) controller.seedPage(id, last.page + 1);
  } else if (intent.kind === "fallback") {
    await fallback();
  } else {
    await postCard({ kind: intent.kind });
  }
}

async function fallback(): Promise<void> {
  await safeSend(nextRoast());
  await postCard({ kind: "welcome" });
}

// ── broadcasts: "Keep me posted" toggle → live watcher + catch-up-on-open ──

/** Bound on host-routed reads so a hung read can't pin the in-flight guard. */
const TICK_TIMEOUT_MS = 25_000;

/** Coalesce the burst of render requests when a chat opens into one refresh. */
const RESUME_DEBOUNCE_MS = 8_000;

/** In-memory mirror of BROADCASTS_KEY, the source of truth for every gate. */
let broadcastsOn = false;
let catchingUp = false;
let lastResume = 0;

/**
 * Boot: load the toggle, warm the snapshot, and (if subscribed) start the
 * watcher + run the first catch-up. Runs before the welcome card so its toggle
 * label is right.
 */
async function boot(): Promise<void> {
  broadcastsOn = await loadBroadcasts();
  console.log(TAG, "boot — broadcasts", broadcastsOn ? "on" : "off");
  void refreshCardData().catch(() => {});
  if (broadcastsOn) {
    startWatcher(onChainEvent);
    void catchUp();
  }
}

/** Toggle handler from the welcome card. Synchronous flag flip, async rest. */
function setBroadcasts(on: boolean): void {
  if (on === broadcastsOn) return;
  broadcastsOn = on;
  void persistBroadcasts(on);
  if (on) {
    void safeSend(
      "You're in the loop. New announcements will land here the moment they are made by the team.",
    );
    // Start clean: baseline = current history so subscribing never dumps the
    // backlog. Only then open the watcher + catch up.
    void startClean().then(() => {
      startWatcher(onChainEvent);
      void catchUp();
    });
  } else {
    void safeSend(
      "Going dark, no more auto-posts. Pull the latest from the menu anytime, or subscribe again whenever you like.",
    );
    stopWatcher();
  }
}

/** A watched event → refresh the affected snapshot slice (+ catch up). */
function onChainEvent(kind: EventKind): void {
  if (kind === "channel") void catchUp();
  void refreshCardData().catch(() => {});
}

/**
 * Chat (re)opened: connections are briefly alive, so refresh the snapshot and,
 * if subscribed, post anything missed. Debounced so a mount-storm fires once.
 */
function onResume(): void {
  const now = Date.now();
  if (now - lastResume < RESUME_DEBOUNCE_MS) return;
  lastResume = now;
  void refreshCardData().catch(() => {});
  if (broadcastsOn) void catchUp();
}

/** Set the seen baseline to the full current history (no backlog on subscribe). */
async function startClean(): Promise<void> {
  try {
    const channel = await withTimeout(loadChannel(), TICK_TIMEOUT_MS, "start-clean");
    await writeSeen(channel?.announcements ?? []);
  } catch (err) {
    console.warn(TAG, "start-clean baseline failed", err);
  }
}

/** Post every announcement newer than the seen set, oldest-first. Idempotent. */
async function catchUp(): Promise<void> {
  if (!broadcastsOn || catchingUp) return;
  catchingUp = true;
  try {
    await withTimeout(postUnseen(), TICK_TIMEOUT_MS, "catch-up");
  } catch (err) {
    console.error(TAG, "catch-up failed", err);
  } finally {
    catchingUp = false;
  }
}

async function postUnseen(): Promise<void> {
  const channel = await loadChannel();
  if (!channel) return;
  const announcements = channel.announcements ?? [];
  const seen = await readSeen();

  // Subscribed but no baseline (storage cleared) → adopt the current history
  // rather than dumping it all into the chat.
  if (seen === null) {
    await writeSeen(announcements);
    return;
  }

  const seenSet = new Set(seen);
  const fresh = announcements.filter((cid) => !seenSet.has(cid));
  if (fresh.length === 0) return;

  console.log(TAG, `${fresh.length} new announcement(s) to post`);
  for (const cid of fresh) {
    try {
      const body = await retrieveJson<AnnouncementBody>(cid);
      await postCard({ kind: "announcement", cid, body });
    } catch (err) {
      console.warn(TAG, "failed to fetch/post announcement", cid, err);
    }
    // Mark seen regardless: a permanently-missing body must not wedge catch-up.
    seenSet.add(cid);
  }
  await writeSeen([...seenSet]);
}

async function loadBroadcasts(): Promise<boolean> {
  try {
    return (await hostLocalStorage.readJSON(BROADCASTS_KEY)) === true;
  } catch {
    return false;
  }
}

async function persistBroadcasts(on: boolean): Promise<void> {
  try {
    await hostLocalStorage.writeJSON(BROADCASTS_KEY, on);
  } catch (err) {
    console.warn(TAG, "persist broadcasts flag failed", err);
  }
}

/** Read the on-chain pointer → channel doc (both host-routed). null if unset. */
async function loadChannel(): Promise<ChannelMetadata | null> {
  const pointer = await readChannelMetadataCid();
  if (isZeroCid(pointer)) {
    console.log(TAG, "channel CID unset — nothing to post yet");
    return null;
  }
  return retrieveJson<ChannelMetadata>(bytes32ToCid(pointer));
}

async function readSeen(): Promise<string[] | null> {
  try {
    const value = await hostLocalStorage.readJSON(SEEN_CIDS_KEY);
    return Array.isArray(value) ? (value as string[]) : null;
  } catch {
    return null;
  }
}

async function writeSeen(cids: string[]): Promise<void> {
  try {
    await hostLocalStorage.writeJSON(SEEN_CIDS_KEY, cids);
  } catch (err) {
    console.warn(TAG, "persist seen-cids failed", err);
  }
}

async function safeSend(value: string): Promise<void> {
  try {
    await chat.sendMessage(ROOM_ID, { tag: "Text", value });
  } catch (err) {
    console.error(TAG, "sendMessage failed", err);
  }
}
