import { decodeBadgeHex } from '../utils/badge'

/** Marker category. Drives color, label-visibility rule, and zoom-reveal tier. */
export type MarkerCategory = 'base' | 'food' | 'activations' | 'service' | 'emergency' | 'scenery' | 'money'

export type MarkerTypeBase = 'room' | 'stage' | 'stairs' | 'chill-zone' | 'elevator' | 'door' | 'swimming-zone' | 'boat' | 'camping'
export type MarkerTypeFood = 'food' | 'bar' | 'coffee' | 'swag'
export type MarkerTypeActivations = 'star'
export type MarkerTypeService = 'restroom' | 'water' | 'wifi' | 'info' | 'registration' | 'charging' | 'smoking' | 'parking'
export type MarkerTypeEmergency = 'exit' | 'extinguisher' | 'medical'
export type MarkerTypeScenery = 'bench' | 'tree'
export type MarkerTypeMoney = 'atm' | 'exchange'

export type MarkerType =
  | MarkerTypeBase
  | MarkerTypeFood
  | MarkerTypeActivations
  | MarkerTypeService
  | MarkerTypeEmergency
  | MarkerTypeScenery
  | MarkerTypeMoney

/** A venue floor definition */
export interface VenueFloor {
  id: string
  label: string
  width: number
  height: number
  /** Extra padding (in SVG units) added on the left/right when fitting the view.
   *  Use this when zone labels sit near the floor edges and would otherwise clip. */
  fitPaddingX?: number
  /** Extra padding (in SVG units) added on top/bottom when fitting. */
  fitPaddingY?: number
}

/** A top-level venue block (Block B, Block D, …). Contains one or more floors. */
export interface VenueBlock {
  id: string
  label: string
  floors: VenueFloor[]
}

/** Sub-zone inside a floor. Corresponds to a colored region with a matching `id` in the floor SVG. */
export interface VenueZone {
  /** Stable id. Must match the `id` attribute on the `<path>` in the floor SVG. */
  id: string
  floorId: string
  label: string
}

/** A single venue map marker (SVG coordinates) */
export interface VenueMarker {
  id: string
  label: string
  /** SVG x coordinate (0 = left edge) */
  x: number
  /** SVG y coordinate (0 = top edge) */
  y: number
  floorId: string
  category: MarkerCategory
  type: MarkerType
  /** Optional sub-zone this marker sits inside (for breadcrumb + zone highlight). */
  zoneId?: string
}

/** Venue map data: blocks → floors, zones, markers. */
export interface VenueMapData {
  blocks: VenueBlock[]
  zones: VenueZone[]
  markers: VenueMarker[]
}

/**
 * What an attendee sees on a session: its accent color and its legend label.
 * `community` is always a sub-event. `official` and `activations` are both
 * schedule entries, told apart only by `ScheduleEntry.category`. Use
 * `activations` for things that run all day next to the talks; those also stay
 * out of the "Upcoming talks" card.
 */
export type SessionCategory = 'official' | 'community' | 'activations'

/** Which categories a schedule entry may use. Sub-events are always `community`. */
export type ScheduleEntryCategory = Exclude<SessionCategory, 'community'>

/** A single schedule entry */
export interface ScheduleEntry {
  /** Stable unique ID */
  id: string
  /** ISO 8601 start time */
  start: string
  /** ISO 8601 end time */
  end: string
  title: string
  description: string
  speakers: string[]
  /** Links to a VenueMarker.id for map integration */
  venueMarkerId?: string
  /** If this schedule entry corresponds to an on-chain sub-event */
  subEventAddress?: string
  /** Missing means 'official'. */
  category?: ScheduleEntryCategory
}

/** Festival metadata JSON schema (stored on Bulletin Chain) */
export interface FestivalMetadata {
  version: string
  type: 'festival'
  name: string
  description: string
  location: {
    venue: string
    address: string
    coordinates?: { lat: number; lng: number }
  }
  /** CID of the festival image on Bulletin Chain */
  image: string
  website?: string
  organizer: string
  tags: string[]
  social?: Record<string, string>
  schedule: ScheduleEntry[]
  venueMap?: VenueMapData
  /** CID of the festival POAP image on Bulletin Chain */
  festivalPoapImage?: string
}

/** Sub-event metadata JSON schema (stored on Bulletin Chain) */
export interface SubEventMetadata {
  version: string
  type: 'sub-event'
  name: string
  description: string
  /** venueMarkerId linking to the parent festival's venue map */
  location: string
  speakers: string[]
  /** Badge as hex string (128 chars = 256 nibbles, one per pixel) */
  badgeHex?: string
  /** Badge pixel array (in-memory, 256 values 0..15 indexing the shared PALETTE). Not stored. Derived from badgeHex. */
  badgePixels?: number[]
}

/**
 * Hydrate a SubEventMetadata retrieved from Bulletin Chain.
 * Decodes `badgeHex` → `badgePixels` so consumers don't need to handle it.
 */
export function hydrateSubEventMetadata(meta: SubEventMetadata): SubEventMetadata {
  if (meta.badgeHex && !meta.badgePixels) {
    meta.badgePixels = decodeBadgeHex(meta.badgeHex)
  }
  return meta
}

/**
 * Channel metadata JSON schema (one CID per festival, refreshed every announcement).
 * Stored on Bulletin Chain. Pointer lives in `Festival.channelMetadataCid`.
 * `announcements` is oldest-first; UI reverses for display.
 */
export interface ChannelMetadata {
  /** Unix ms. Channel creation, not last update. */
  createdAt: number
  /** Body CIDs (base58), oldest-first append order. Soft-cap ~500. */
  announcements: string[]
}

/**
 * Single announcement body (one CID per announcement, immutable). Stored on
 * Bulletin Chain; its CID is appended to ChannelMetadata.announcements.
 *
 * `content` is untrusted plain text with no sanitization layer: render it with
 * text interpolation, never `v-html` / `innerHTML`. `senderName` /
 * `senderAddress` are client-set display hints, not proof of authorship. The
 * on-chain tx signer is authoritative.
 */
export interface AnnouncementBody {
  /** Plaintext, ~2000 char UX cap (not a chain limit). */
  content: string
  /** Unix ms (admin clock at send time). */
  timestamp: number
  /** Display hint, NOT verifiable. See interface docstring. */
  senderName?: string
  /** Display hint, NOT verifiable. The on-chain tx signer is authoritative. */
  senderAddress?: string
}

