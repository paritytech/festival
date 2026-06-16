/** Loaders: host-routed reads → card item shapes via the pure mappers in items.ts. */

import { type AnnouncementItem, type ScheduleItem } from "./cards";
import {
  bytes32ToCid,
  isZeroCid,
  readChannelMetadataCid,
  readMetadataCid,
  retrieveJson,
} from "./chain";
import {
  type AnnouncementBody,
  type ChannelMetadata,
  type FestivalMetadata,
  type SubEventMetadata,
} from "./config";
import { activationsFrom, announcementItemFrom, type FestivalInfo, talksFrom, toScheduleItem } from "./items";
import { readSessions } from "./sessions";

/**
 * Snapshot schema version. Bump it whenever the snapshot's shape or filtering
 * changes (like now, with activations dropped from `talks`), so a snapshot
 * saved by an older worker gets thrown away instead of served stale.
 */
export const CARD_SNAPSHOT_VERSION = 2;

/**
 * Everything the cards render, resolved in one sweep and serializable to
 * hostLocalStorage. Cards render snapshot-first because the host pauses the
 * worker's connections while the chat is open — live reads at render time hang
 * exactly when cards are visible. Lists are complete; filtering is render-time.
 */
export interface CardSnapshot {
  /** Schema version (see CARD_SNAPSHOT_VERSION). */
  version: number;
  /** Unix ms the snapshot was built. */
  at: number;
  festivalName: string;
  talks: ScheduleItem[];
  sessions: ScheduleItem[];
  /** Programming that runs all day (category === 'activations'). */
  activations: ScheduleItem[];
  /** Newest first, bodies included. */
  announcements: AnnouncementItem[];
}

const TAG = "[w3s-announcements]";

export async function buildSnapshot(): Promise<CardSnapshot> {
  const festival = await loadFestival();
  // A failed sessions read must not reject alongside announcements + talks.
  const [announcements, sessions] = await Promise.all([
    loadAnnouncements(3),
    loadSessionItems(festival).catch((err) => {
      console.warn(TAG, "sessions load failed — card will show empty", err);
      return [] as ScheduleItem[];
    }),
  ]);
  return {
    version: CARD_SNAPSHOT_VERSION,
    at: Date.now(),
    festivalName: festival.name,
    talks: talksFrom(festival),
    sessions,
    activations: activationsFrom(festival),
    announcements,
  };
}

export async function loadFestival(): Promise<FestivalInfo> {
  const pointer = await readMetadataCid();
  if (isZeroCid(pointer)) return { name: "Festival", schedule: [], markerLabels: new Map() };
  const meta = await retrieveJson<FestivalMetadata>(bytes32ToCid(pointer));
  return {
    name: meta.name?.trim() || "Festival",
    schedule: meta.schedule ?? [],
    markerLabels: new Map((meta.venueMap?.markers ?? []).map((m) => [m.id, m.label])),
  };
}

/** Latest announcements, newest first. Missing bodies are skipped. */
export async function loadAnnouncements(limit = 3): Promise<AnnouncementItem[]> {
  const pointer = await readChannelMetadataCid();
  if (isZeroCid(pointer)) return [];
  const channel = await retrieveJson<ChannelMetadata>(bytes32ToCid(pointer));
  const cids = (channel.announcements ?? []).slice(-limit).reverse();
  const items = await Promise.all(
    cids.map(async (cid) => {
      try {
        return announcementItemFrom(cid, await retrieveJson<AnnouncementBody>(cid));
      } catch {
        return null;
      }
    }),
  );
  return items.filter((a): a is AnnouncementItem => a !== null);
}

/** All on-chain FestivalSessions + their Bulletin metadata, sorted. */
export async function loadSessionItems(festival: FestivalInfo): Promise<ScheduleItem[]> {
  const onChain = await readSessions();
  if (onChain.length === 0) return [];
  const withMeta = await Promise.all(
    onChain.map(async (s) => {
      try {
        return { s, meta: await retrieveJson<SubEventMetadata>(bytes32ToCid(s.metadataCid)) };
      } catch {
        return null;
      }
    }),
  );
  return withMeta
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.s.startTime - b.s.startTime)
    .map(({ s, meta }) =>
      toScheduleItem(
        s.address,
        new Date(s.startTime * 1000),
        new Date(s.endTime * 1000),
        meta.name,
        meta.speakers ?? [],
        festival.markerLabels.get(meta.location),
        "Session",
      ),
    );
}
