import type {
  VenueBlock,
  VenueFloor,
  VenueMarker,
  VenueZone,
} from "../metadata/schemas";

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
export const VENUE_FLOORS: VenueFloor[] = [
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

/** "1st Floor". Breadcrumb used in card headers and subtitle.
 *  Rule: location context is the floor label only ("Ground Floor", "1st Floor",
 *  "Venue" for outdoor). Block labels never appear in user-facing strings. */
export function getFloorBreadcrumb(floorId: string): string {
  if (isOutdoorFloor(floorId)) return VENUE_OUTDOOR_FLOOR.label;
  return getFloor(floorId)?.label ?? floorId;
}

export function getMarkerLabel(
  markerId: string,
  markers: VenueMarker[],
): string {
  return markers.find((m) => m.id === markerId)?.label ?? markerId;
}

/** "Studio 1 · 1st Floor". Marker label + floor breadcrumb. */
export function getMarkerLocationLabel(
  markerId: string,
  markers: VenueMarker[],
): string {
  const marker = markers.find((m) => m.id === markerId);
  if (!marker) return markerId;
  const breadcrumb = getFloorBreadcrumb(marker.floorId);
  return breadcrumb ? `${marker.label} · ${breadcrumb}` : marker.label;
}

// ── Coordinate-based locations ──
// Format: "coord:<floorId>:<x>:<y>"

export interface CoordLocation {
  floorId: string;
  x: number;
  y: number;
}

const COORD_PREFIX = "coord:";

export function isCoordLocation(location: string): boolean {
  return location.startsWith(COORD_PREFIX);
}

export function encodeCoordLocation(
  floorId: string,
  x: number,
  y: number,
): string {
  return `${COORD_PREFIX}${floorId}:${x}:${y}`;
}

export function parseCoordLocation(location: string): CoordLocation | null {
  if (!isCoordLocation(location)) return null;
  const parts = location.slice(COORD_PREFIX.length).split(":");
  if (parts.length < 3) return null;
  const x = parseInt(parts[parts.length - 2], 10);
  const y = parseInt(parts[parts.length - 1], 10);
  const floorId = parts.slice(0, -2).join(":");
  if (!floorId || isNaN(x) || isNaN(y)) return null;
  return { floorId, x, y };
}

/** Resolve a location string (marker ID or coord) to a human-readable label. */
export function resolveLocationLabel(
  location: string,
  markers: VenueMarker[],
): string {
  const coord = parseCoordLocation(location);
  if (coord) {
    const nearest = findNearestMarker(coord.x, coord.y, coord.floorId, markers);
    const breadcrumb = getFloorBreadcrumb(coord.floorId);
    if (nearest)
      return breadcrumb ? `${nearest.label} · ${breadcrumb}` : nearest.label;
    return breadcrumb || coord.floorId;
  }
  return getMarkerLocationLabel(location, markers);
}

/** Build a map deep-link query string for a location (marker ID or coord). */
export function locationToMapQuery(
  location: string,
  markers: VenueMarker[],
): string {
  const coord = parseCoordLocation(location);
  if (coord) return `spot=${coord.floorId}:${coord.x}:${coord.y}`;
  const marker = markers.find((m) => m.id === location);
  if (marker) return `marker=${marker.id}`;
  return "";
}

// ── Picked-location label resolution ──
// Used by the session-creation location picker. The picker stores
// `{ x, y, floorId, zoneId }` and renders zone-aware labels.

export interface PickedLocation {
  x: number;
  y: number;
  floorId: string;
  zoneId: string | null;
  /** Set when the user tapped a marker (vs. dropping a pin on bare map).
   *  Lets the caller do venue-conflict checks without round-tripping coords
   *  through nearest-marker resolution. */
  markerId?: string | null;
}

export interface PickedLocationParts {
  zone: string | null;
  /** Floor label ("Ground Floor", "1st Floor") or "Venue" for outdoor. */
  floor: string;
  marker: string | null;
}

export function describePickedLocation(
  loc: PickedLocation,
  markers: VenueMarker[],
  zones: VenueZone[],
): PickedLocationParts {
  const nearest = findNearestMarker(loc.x, loc.y, loc.floorId, markers);
  if (isOutdoorFloor(loc.floorId)) {
    return {
      zone: null,
      floor: VENUE_OUTDOOR_FLOOR.label,
      marker: nearest?.label ?? null,
    };
  }
  const zoneLabel = loc.zoneId
    ? zones.find((z) => z.id === loc.zoneId)?.label ?? null
    : null;
  return {
    zone: zoneLabel,
    floor: getFloor(loc.floorId)?.label ?? loc.floorId,
    marker: nearest?.label ?? null,
  };
}

/** "Chill Zone · 1st Floor". Full breadcrumb shown on the preview. */
export function formatPickedLocationLong(parts: PickedLocationParts): string {
  if (parts.zone)
    return [parts.zone, parts.floor].filter(Boolean).join(" · ");
  if (parts.marker)
    return [parts.marker, parts.floor].filter(Boolean).join(" · ");
  return ["Custom location", parts.floor].filter(Boolean).join(" · ");
}

/** Two-line bottom-card format used inside the picker modal. */
export function formatPickedLocationCard(parts: PickedLocationParts): {
  caption: string;
  bold: string;
} {
  const caption = parts.floor;
  const bold = parts.zone ?? parts.marker ?? "Custom location";
  return { caption, bold };
}

/** Find nearest marker on the same floor within a max distance (SVG px). */
export function findNearestMarker(
  x: number,
  y: number,
  floorId: string,
  markers: VenueMarker[],
  maxDistance = 150,
): VenueMarker | null {
  const floorMarkers = markers.filter((m) => m.floorId === floorId);
  if (!floorMarkers.length) return null;
  let best: VenueMarker | null = null;
  let bestDist = Infinity;
  for (const m of floorMarkers) {
    const d = Math.sqrt((x - m.x) ** 2 + (y - m.y) ** 2);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return bestDist <= maxDistance ? best : null;
}
