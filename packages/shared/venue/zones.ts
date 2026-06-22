import type { VenueZone } from '../metadata/schemas'

/**
 * Default zones for the current festival. Source of truth at runtime is
 * `venueMap.zones[]` in the festival metadata; this array provides labels
 * for the colored regions baked into the floor plan SVGs.
 *
 * The `id` of each zone MUST match the slug the map engine derives from the
 * matching GeoJSON feature (its `id` if present, otherwise `slugify(name)`)
 * so that clicking a colored region auto-fills the marker's zone and the
 * selected-marker highlight finds the right polygon. Zone ids are scoped to
 * a floor — duplicates across floors (e.g. "Foyer") are fine.
 */
export const DEFAULT_ZONES: VenueZone[] = [
  // Block B · 1st Floor
  { id: 'studio-1', floorId: 'block-b-first-floor', label: 'Studio 1' },
  { id: 'foyer', floorId: 'block-b-first-floor', label: 'Foyer' },
  { id: 'studio-2', floorId: 'block-b-first-floor', label: 'Studio 2' },

  // Block B · Ground
  // ids below mirror the slugs the converter emits from current Figma layer
  // names; rename Figma + re-run `npm run build:maps` to drop the typo / split
  // PBA back into H14 + H15.
  { id: 'outside-courtyard', floorId: 'block-b-first-ground', label: 'Courtyard' },
  { id: 'pba-roonm', floorId: 'block-b-first-ground', label: 'PBA Rooms' },
  { id: 'h2-rooms', floorId: 'block-b-first-ground', label: 'H2' },
  { id: 'studio-4', floorId: 'block-b-first-ground', label: 'Studio 4' },
  { id: 'bar', floorId: 'block-b-first-ground', label: 'Bar' },
  { id: 'foyer', floorId: 'block-b-first-ground', label: 'Foyer' },
  { id: 'check-in', floorId: 'block-b-first-ground', label: 'Check-in' },
]

export function getZone(zoneId: string, zones: VenueZone[]): VenueZone | undefined {
  return zones.find(z => z.id === zoneId)
}

export function zonesForFloor(floorId: string, zones: VenueZone[]): VenueZone[] {
  return zones.filter(z => z.floorId === floorId)
}

/** "Studio 1" → breadcrumb suffix for a card header. */
export function getZoneLabel(zoneId: string | undefined, zones: VenueZone[]): string | undefined {
  if (!zoneId) return undefined
  return zones.find(z => z.id === zoneId)?.label
}
