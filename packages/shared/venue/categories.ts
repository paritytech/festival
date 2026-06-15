import type { MarkerCategory, MarkerType } from '../metadata/schemas'

export interface CategorySpec {
  /** Solid fill color of the circular marker. */
  color: string
  /** Show a white text pill under the icon? */
  hasLabel: boolean
  /** Size class controls the CSS variable tier used when rendering. */
  size: 'lg' | 'sm'
  /** Lowest zoom tier (0..4) at which markers of this category become visible. */
  revealTier: 0 | 1 | 2 | 3 | 4
}

export const CATEGORIES: Record<MarkerCategory, CategorySpec> = {
  base:        { color: '#3561FF', hasLabel: true,  size: 'lg', revealTier: 3 },
  food:        { color: '#FF7700', hasLabel: true,  size: 'lg', revealTier: 1 },
  activations: { color: '#FFB300', hasLabel: true,  size: 'lg', revealTier: 2 },
  service:     { color: '#35C759', hasLabel: false, size: 'sm', revealTier: 4 },
  emergency:   { color: '#FF2670', hasLabel: false, size: 'sm', revealTier: 4 },
  money:       { color: '#9462FA', hasLabel: false, size: 'sm', revealTier: 4 },
  // Scenery icons (benches, trees) ship with their own dark rounded-square
  // backdrop inside the SVG; `color` here is only used by the admin row tile,
  // and matching the SVG bg keeps the row visually seamless.
  scenery:     { color: '#1F1F1F', hasLabel: false, size: 'sm', revealTier: 0 },
}

/** All types valid for a given category. Drives the admin type picker. */
export const TYPES_BY_CATEGORY: Record<MarkerCategory, readonly MarkerType[]> = {
  base: ['room', 'stage', 'stairs', 'chill-zone', 'elevator', 'door', 'swimming-zone', 'boat', 'camping'],
  food: ['food', 'bar', 'coffee', 'swag'],
  activations: ['star'],
  service: ['restroom', 'water', 'wifi', 'info', 'registration', 'charging', 'smoking', 'parking'],
  emergency: ['exit', 'extinguisher', 'medical'],
  money: ['atm', 'exchange'],
  scenery: ['bench', 'tree'],
}

/** Human-readable label for a marker type (used in admin pickers). */
export const TYPE_LABELS: Record<MarkerType, string> = {
  room: 'Room / Meeting Room',
  stage: 'Stage',
  stairs: 'Stairs',
  'chill-zone': 'Chill Zone',
  elevator: 'Elevator',
  door: 'Doors',
  'swimming-zone': 'Swimming Zone',
  boat: 'Boats',
  camping: 'Camping',
  food: 'Food',
  bar: 'Bar',
  coffee: 'Coffee / Tea',
  swag: 'Swag Stand',
  star: 'Activation',
  restroom: 'Restroom',
  water: 'Water Spot',
  wifi: 'WiFi Zone',
  info: 'Info Spot',
  registration: 'Registration',
  charging: 'Charging Point',
  smoking: 'Smoking Area',
  parking: 'Parking Lot',
  exit: 'Emergency Exit',
  extinguisher: 'Extinguisher',
  medical: 'Medical Aid',
  bench: 'Benches',
  tree: 'Trees',
  atm: 'ATM',
  exchange: 'Currency Exchange',
}

export function getCategory(cat: MarkerCategory): CategorySpec {
  return CATEGORIES[cat]
}

/** Marker types that can be selected as a session location in the picker.
 *  Tapping any other marker is treated as a blocked spot. */
export const SESSION_LOCATION_ALLOWED_TYPES: ReadonlySet<MarkerType> = new Set<MarkerType>([
  'room', 'stage', 'chill-zone',
  'food', 'bar', 'coffee',
  'star',
])

export function isMarkerAllowedAsSessionLocation(type: MarkerType): boolean {
  return SESSION_LOCATION_ALLOWED_TYPES.has(type)
}

/** Coerce a possibly-undefined / legacy category string to a valid MarkerCategory. */
export function normalizeCategory(cat: string | undefined | null): MarkerCategory {
  if (cat && cat in CATEGORIES) return cat as MarkerCategory
  return 'base'
}

/** Coerce a possibly-undefined / legacy type string to a valid MarkerType for its category. */
export function normalizeType(cat: MarkerCategory, type: string | undefined | null): MarkerType {
  const list = TYPES_BY_CATEGORY[cat]
  if (type && (list as readonly string[]).includes(type)) return type as MarkerType
  return list[0]!
}
