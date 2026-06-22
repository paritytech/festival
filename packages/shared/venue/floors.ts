import type {
  VenueBlock,
  VenueFloor,
  VenueMarker,
  VenueZone,
} from "../metadata/schemas";
import { TYPE_LABELS } from "./categories";

/** Cap for resolved venue labels rendered alongside a session time. */
export const LOCATION_LABEL_MAX_CHARS = 40

/** Outdoor venue overhead. Treated as a pseudo-"floor" so markers can be
 *  placed against it using the same coordinate model as indoor floors,
 *  but it does not belong to any VenueBlock. */
export const VENUE_OUTDOOR_FLOOR: VenueFloor = {
  id: "venue",
  label: "Outdoor",
  width: 3436,
  height: 5184,
};

/** Hardcoded venue structure for the current festival.
 *  Single-festival scope. Multi-festival support is out of scope for V1. */
export const VENUE_BLOCKS: VenueBlock[] = [
  {
    id: "block-b",
    label: "Block B",
    floors: [
      {
        id: "block-b-first-ground",
        label: "Ground Floor",
        width: 1887,
        height: 2409,
        // PBA H14/H15 zones sit at the left edge; pad so labels don't clip.
        fitPaddingX: 110,
      },
      {
        id: "block-b-first-floor",
        label: "1st Floor",
        width: 1353,
        height: 1063,
      },
    ],
  },
];

/** Flat list of all floors across all blocks, plus the outdoor pseudo-floor. */
const VENUE_FLOORS: VenueFloor[] = [
  VENUE_OUTDOOR_FLOOR,
  ...VENUE_BLOCKS.flatMap((b) => b.floors),
];

/** True if the given floor id is the outdoor pseudo-floor. */
export function isOutdoorFloor(floorId: string): boolean {
  return floorId === VENUE_OUTDOOR_FLOOR.id;
}

/** Default block shown on first visit. */
export const DEFAULT_BLOCK_ID = "block-b";
/** Default floor shown when entering indoor mode. */
export const DEFAULT_FLOOR_ID = "block-b-first-ground";

export function getBlock(blockId: string): VenueBlock | undefined {
  return VENUE_BLOCKS.find((b) => b.id === blockId);
}

export function getFloor(floorId: string): VenueFloor | undefined {
  return VENUE_FLOORS.find((f) => f.id === floorId);
}

/** Find the block that owns a given floor. */
export function getBlockByFloor(floorId: string): VenueBlock | undefined {
  return VENUE_BLOCKS.find((b) => b.floors.some((f) => f.id === floorId));
}

/** Short map-context label per the location-text legend:
 *  "Outdoor" / "Ground" / "1st Floor". Used as the first segment of a full
 *  "[Floor] · [Zone] · [Marker]" location string. */
export function getMapContextLabel(floorId: string): string {
  if (isOutdoorFloor(floorId)) return "Outdoor";
  const f = getFloor(floorId);
  if (!f) return floorId;
  return f.label === "Ground Floor" ? "Ground" : f.label;
}

export function getMarkerLabel(
  markerId: string,
  markers: VenueMarker[],
): string {
  return markers.find((m) => m.id === markerId)?.label ?? markerId;
}

// ── Coordinate-based locations ──
// Format: "coord:<floorId>:<zoneId>:<x>:<y>" — zoneId is the polygon zone the
// picker resolved this point to (empty when the user picked outside any zone).

export interface CoordLocation {
  floorId: string;
  zoneId: string | null;
  x: number;
  y: number;
}

const COORD_PREFIX = "coord:";

export function encodeCoordLocation(
  floorId: string,
  zoneId: string | null,
  x: number,
  y: number,
): string {
  return `${COORD_PREFIX}${floorId}:${zoneId ?? ""}:${x}:${y}`;
}

export function parseCoordLocation(location: string): CoordLocation | null {
  if (!location.startsWith(COORD_PREFIX)) return null;
  const parts = location.slice(COORD_PREFIX.length).split(":");
  if (parts.length < 4) return null;
  const x = parseInt(parts[parts.length - 2], 10);
  const y = parseInt(parts[parts.length - 1], 10);
  const zoneId = parts[parts.length - 3] || null;
  const floorId = parts.slice(0, -3).join(":");
  if (!floorId || isNaN(x) || isNaN(y)) return null;
  return { floorId, zoneId, x, y };
}

/** Find nearest marker on the same floor within a max distance (SVG px). */
export function findNearestMarker(
  x: number,
  y: number,
  floorId: string,
  markers: VenueMarker[],
  maxDistance = 150,
): VenueMarker | null {
  let best: VenueMarker | null = null;
  let bestDist = Infinity;
  for (const m of markers) {
    if (m.floorId !== floorId) continue;
    const d = Math.hypot(x - m.x, y - m.y);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return bestDist <= maxDistance ? best : null;
}

// ── Picked-location label resolution ──
// Used by the session-creation location picker. The picker stores
// `{ x, y, floorId, zoneId }` and renders zone-aware labels.

export interface PickedLocation {
  x: number;
  y: number;
  floorId: string;
  zoneId: string | null;
}

// ── Location text formats per the location-text legend ──
// Single line: "[Map context] · [Zone] · [Marker]" (full) or
//              "[Map context] · [Zone]" (short).
// Two-line chip: marker name (or zone name) headline + sub-label.
// All formats feed off the {floor, zone, marker} triplet below. Segments
// drop when empty and de-duplicate so a marker in a same-named zone renders
// once (e.g. zone "Bar" + marker "Bar" → "Ground · Bar").

interface LocationTriplet {
  floor: string;
  zone: string | null;
  marker: string | null;
}

function findZoneLabel(
  zoneId: string | null | undefined,
  zones: VenueZone[],
): string | null {
  if (!zoneId) return null;
  return zones.find((z) => z.id === zoneId)?.label ?? null;
}

/** Join segments with " · ", skipping empty ones and collapsing adjacent
 *  duplicates so a marker that shares its zone's name renders once. */
function joinLocationSegments(
  segments: (string | null | undefined)[],
): string {
  const out: string[] = [];
  for (const s of segments) {
    if (s && s !== out[out.length - 1]) out.push(s);
  }
  return out.join(" · ");
}

/** Triplet for a typed marker. Icon-only categories (service / emergency /
 *  money / scenery) save with an empty label by design, so fall back to the
 *  type label (e.g. "Restroom", "ATM") — kept as a render-time lookup so it
 *  stays rename- and i18n-safe rather than baked into stored metadata. */
function tripletFromMarker(
  marker: VenueMarker,
  zones: VenueZone[],
): LocationTriplet {
  return {
    floor: getMapContextLabel(marker.floorId),
    zone: findZoneLabel(marker.zoneId, zones),
    marker: marker.label || TYPE_LABELS[marker.type],
  };
}

/** Triplet for any spot on the map (CoordLocation from storage, or
 *  PickedLocation from the picker). Both carry an explicit `zoneId` (the
 *  polygon zone the picker resolved this point to, or `null` when outside
 *  any zone). The marker segment is inferred from the nearest marker, if
 *  any. */
function tripletFromSpot(
  spot: { x: number; y: number; floorId: string; zoneId: string | null },
  markers: VenueMarker[],
  zones: VenueZone[],
): LocationTriplet {
  const nearest = findNearestMarker(spot.x, spot.y, spot.floorId, markers);
  return {
    floor: getMapContextLabel(spot.floorId),
    zone: findZoneLabel(spot.zoneId, zones),
    marker: nearest?.label ?? null,
  };
}

/** Triplet from a stored location string (marker id or `coord:...`), or
 *  `null` if the string doesn't resolve to anything we know. */
function tripletFromStored(
  location: string,
  markers: VenueMarker[],
  zones: VenueZone[],
): LocationTriplet | null {
  const coord = parseCoordLocation(location);
  if (coord) return tripletFromSpot(coord, markers, zones);
  const marker = markers.find((m) => m.id === location);
  return marker ? tripletFromMarker(marker, zones) : null;
}

const formatFull = (t: LocationTriplet) =>
  joinLocationSegments([t.floor, t.zone, t.marker]);

const formatShort = (t: LocationTriplet) =>
  joinLocationSegments([t.floor, t.zone ?? t.marker]);

/** Stored location → full "[Floor] · [Zone] · [Marker]". Returns the raw
 *  location string when it doesn't resolve. */
export function resolveFullLocationLabel(
  location: string,
  markers: VenueMarker[],
  zones: VenueZone[],
): string {
  const t = tripletFromStored(location, markers, zones);
  return t ? formatFull(t) : location;
}

/** Stored location → short "[Floor] · [Zone]". Used on Program cards. */
export function resolveShortLocationLabel(
  location: string,
  markers: VenueMarker[],
  zones: VenueZone[],
): string {
  const t = tripletFromStored(location, markers, zones);
  return t ? formatShort(t) : location;
}

// ── Two-line "chip" format ──
// Headline + sub-label, used by the picker bottom card and the map drawer's
// selected card. Marker name in the headline if present, otherwise zone name;
// sub drops the zone when it duplicates the headline.

export interface LocationChip {
  headline: string;
  sub: string;
}

function chipFromTriplet(t: LocationTriplet): LocationChip {
  if (t.marker) {
    return {
      headline: t.marker,
      sub: joinLocationSegments([t.floor, t.zone === t.marker ? null : t.zone]),
    };
  }
  if (t.zone) return { headline: t.zone, sub: t.floor };
  return { headline: "Custom location", sub: t.floor };
}

/** Two-line chip for a typed marker (e.g. the map drawer's selected card). */
export function formatChipFromMarker(
  marker: VenueMarker,
  zones: VenueZone[],
): LocationChip {
  return chipFromTriplet(tripletFromMarker(marker, zones));
}

/** Two-line chip for an in-progress PickedLocation (picker bottom card). */
export function formatChipFromPicked(
  loc: PickedLocation,
  markers: VenueMarker[],
  zones: VenueZone[],
): LocationChip {
  return chipFromTriplet(tripletFromSpot(loc, markers, zones));
}
