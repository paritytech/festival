/**
 * Worker configuration + on-chain doc types.
 *
 * `FESTIVAL_ADDRESS` and `CHAIN_GENESIS_HASH` are injected at build time by
 * `build.mts` (esbuild `define`) from the same `VITE_*` env the attendee app
 * builds with — so a build for any environment targets the matching Festival +
 * network. The fallbacks are the paseo-next-v2 defaults, for a bare local build.
 *
 * esbuild replaces the `process.env.WORKER_*` references with literals; the
 * bundle never touches `process` at runtime.
 */

/** Festival contract (pallet-revive). Injected from VITE_FESTIVAL_ADDRESS. */
export const FESTIVAL_ADDRESS = (process.env.WORKER_FESTIVAL_ADDRESS ||
  "0xe4e3a76a4ccae0c8bbdd7472f2f766ab2f9890df") as `0x${string}`;

/** Main-chain genesis handed to createPapiProvider. Injected from the network. */
export const CHAIN_GENESIS_HASH = (process.env.WORKER_CHAIN_GENESIS ||
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f") as `0x${string}`;

/**
 * Attendee SPA dotNS host (e.g. "festival-attendee-paseo2.dot"), baked from the
 * same `VITE_DOTNS_ID` the attendee app builds with. Empty in dev (no `.dot`
 * host) → deeplink buttons no-op.
 */
export const FESTIVAL_DOTNS = process.env.WORKER_DOTNS_ID || "";

/**
 * Scheme for SPA deeplinks posted as tappable chat links. If the host's link
 * detector only recognises http/https (iOS `NSDataDetector`), flip to "https".
 */
const DEEPLINK_SCHEME = "polkadot";

/** Absolute deeplink into the attendee SPA, or null when no dotNS is configured. */
export function spaDeeplink(hashPath: string): string | null {
  return FESTIVAL_DOTNS ? `${DEEPLINK_SCHEME}://${FESTIVAL_DOTNS}${hashPath}` : null;
}

/**
 * Read-only origin for `ReviveApi.call` dry-runs — an EVM-derived AccountId32
 * (H160 0x00…00, last 12 bytes 0xEE). pallet-revive treats it as mapped without
 * `map_account`, so it needs no funds and no signer.
 */
export const READ_ONLY_ORIGIN =
  "5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1";

/** Bot + room identity surfaced in the host contact list / chat. */
export const BOT_ID = "festival-announcements-bot";
export const ROOM_ID = "festival-announcements-room";
export const BOT_NAME = "Web3 Summit";

/** hostLocalStorage key holding the body CIDs already posted to chat. */
export const SEEN_CIDS_KEY = "festival-announcements:seen-cids";

/**
 * hostLocalStorage key for the per-device "Keep me posted" opt-in. When off
 * (default) the worker never auto-posts; the feed stays pull-only via the
 * "Latest announcements" card. When on, it posts anything newer than
 * SEEN_CIDS_KEY on each chat open (and live, where the connection stays alive).
 */
export const BROADCASTS_KEY = "festival-announcements:broadcasts-on";

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Announcement channel doc on Bulletin: body CIDs, ordered oldest-first.
 *
 * Mirrors `@festival/shared`'s `ChannelMetadata` (kept local, not imported, so
 * the worker bundle stays self-contained — no runtime coupling to shared's
 * chain client). Source of truth: packages/shared/metadata/schemas.ts.
 */
export interface ChannelMetadata {
  /** Unix ms — channel creation, not last update. */
  createdAt: number;
  /** Body CIDs, oldest-first append order. */
  announcements: string[];
}

/**
 * A single announcement body on Bulletin. `content` is untrusted and carries no
 * sanitization layer — render it as plain text only (a Text chat message is
 * safe; never feed it to innerHTML). `senderName`/`senderAddress` are display
 * hints, not verified against the on-chain tx signer. Mirrors shared's
 * `AnnouncementBody`.
 */
export interface AnnouncementBody {
  content: string;
  timestamp: number;
  senderName?: string;
  senderAddress?: string;
}

/**
 * Festival schedule entry — the subset of `@festival/shared`'s `ScheduleEntry`
 * the cards render. `start`/`end` are ISO 8601. Source of truth:
 * packages/shared/metadata/schemas.ts.
 */
export interface ScheduleEntry {
  id: string;
  start: string;
  end: string;
  title: string;
  speakers: string[];
  /** Links to a VenueMarker.id on the festival venue map. */
  venueMarkerId?: string;
  /**
   * 'activations' is for things that run all day; we hide those from the
   * "Upcoming talks" and time window cards. Missing means 'official'. Mirrors
   * shared's `ScheduleEntry.category`.
   */
  category?: "official" | "activations";
}

/**
 * Festival metadata doc on Bulletin, pointed to by `Festival.metadataCid()`.
 * Only the fields the cards need are typed here (the real doc has much more).
 */
export interface FestivalMetadata {
  name?: string;
  schedule: ScheduleEntry[];
  venueMap?: {
    markers: { id: string; label: string }[];
  };
}

/**
 * FestivalSession metadata doc on Bulletin (shared's `SubEventMetadata`).
 * `location` is a venueMarkerId into the parent festival's venue map.
 */
export interface SubEventMetadata {
  name: string;
  description: string;
  location: string;
  speakers: string[];
}
