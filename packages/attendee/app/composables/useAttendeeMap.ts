import { ref, computed } from 'vue'
import type { VenueMarker, VenueZone, ScheduleEntry } from '@festival/shared/metadata/schemas'
import {
  DEFAULT_FLOOR_ID,
  VENUE_BLOCKS,
  VENUE_OUTDOOR_FLOOR,
  findNearestMarker,
  getBlock,
  getBlockByFloor,
  getFloor,
  isOutdoorFloor,
  parseCoordLocation,
} from '@festival/shared/venue/floors'
import { DEFAULT_ZONES } from '@festival/shared/venue/zones'
import { parseFestivalDate } from '@festival/shared/utils/time'
import type { UserSpot } from '@festival/shared/venue/map-engine-ml'
import { useFestival } from './useFestival'
import { useSubEvents } from './useSubEvents'

export type MapMode = 'outdoor' | 'indoor'

/** What the map bottom-card session strip renders. `source` drives the
 *  accent color (program = white, community = purple). */
export interface MapSessionStripData {
  kind: 'ongoing' | 'soon'
  source: 'program' | 'community' | 'activations'
  title: string
  /** Minutes until start. Only set for kind 'soon'. */
  minutes?: number
  /** Detail route to push on tap. */
  route: string
}

// ── Session-scoped singleton state. Persists across tab nav; gone on reload. ──
const _mode = ref<MapMode>('outdoor')
const _indoorFloorId = ref<string>(DEFAULT_FLOOR_ID)
const _selectedMarkerId = ref<string | null>(null)
const _userSpot = ref<UserSpot | null>(null)

export function useAttendeeMap() {
  const { metadata } = useFestival()
  const { subEvents } = useSubEvents()

  const markers = computed<VenueMarker[]>(() => metadata.value?.venueMap?.markers ?? [])

  const zones = computed<VenueZone[]>(() => metadata.value?.venueMap?.zones ?? DEFAULT_ZONES)

  const schedule = computed<ScheduleEntry[]>(() => metadata.value?.schedule ?? [])

  const blocks = computed(() => VENUE_BLOCKS)

  /** The floor the engine should currently render. Outdoor pseudo-floor when in
   *  outdoor mode; the chosen indoor floor otherwise. */
  const activeFloorId = computed(() =>
    _mode.value === 'outdoor' ? VENUE_OUTDOOR_FLOOR.id : _indoorFloorId.value,
  )

  /** The owning block of the active indoor floor, or undefined while outdoors. */
  const activeBlock = computed(() =>
    _mode.value === 'indoor' ? getBlockByFloor(_indoorFloorId.value) : undefined,
  )

  const activeFloor = computed(() => getFloor(activeFloorId.value))
  const selectedMarker = computed<VenueMarker | null>(() =>
    markers.value.find(m => m.id === _selectedMarkerId.value) ?? null,
  )

  // True once the festival metadata has resolved (so the marker set is final).
  const markersReady = computed(() => metadata.value !== null)

  function select(marker: VenueMarker) {
    _userSpot.value = null
    _selectedMarkerId.value = marker.id
    if (isOutdoorFloor(marker.floorId)) {
      _mode.value = 'outdoor'
    } else {
      _mode.value = 'indoor'
      _indoorFloorId.value = marker.floorId
    }
  }

  function clearSelection() {
    _selectedMarkerId.value = null
  }

  function placeSpot(x: number, y: number, floorId: string) {
    _selectedMarkerId.value = null
    _userSpot.value = { x, y, floorId }
  }

  function removeSpot() {
    _userSpot.value = null
  }

  /** Enter indoor mode at the given floor (defaults to ground). */
  function enterBuilding(floorId: string = DEFAULT_FLOOR_ID) {
    _mode.value = 'indoor'
    _indoorFloorId.value = floorId
    _selectedMarkerId.value = null
    _userSpot.value = null
  }

  /** Exit indoor mode and return to the outdoor overhead. */
  function exitToOutdoor() {
    _mode.value = 'outdoor'
    _selectedMarkerId.value = null
    _userSpot.value = null
  }

  /** Switch indoor floor. No-op when called from outdoor mode. */
  function switchFloor(floorId: string) {
    const floor = getFloor(floorId)
    if (!floor || isOutdoorFloor(floorId)) return
    _mode.value = 'indoor'
    _indoorFloorId.value = floorId
    _selectedMarkerId.value = null
    _userSpot.value = null
  }

  /** True when a community session's `metadata.location` belongs to the
   *  given marker. Cascade: exact marker id → coord whose nearest marker
   *  (150px) is this one → coord whose persisted zone matches the marker's. */
  function sessionMatchesMarker(
    location: string,
    marker: VenueMarker,
  ): boolean {
    if (!location) return false
    if (location === marker.id) return true
    const coord = parseCoordLocation(location)
    if (!coord || coord.floorId !== marker.floorId) return false
    const nearest = findNearestMarker(coord.x, coord.y, coord.floorId, markers.value)
    if (nearest) return nearest.id === marker.id
    return marker.zoneId != null && coord.zoneId === marker.zoneId
  }

  /** The most-imminent program entry or community session tied to a marker.
   *  Ongoing beats upcoming; upcoming must start within 60 min. Returns at
   *  most one strip across both sources, or null. */
  function getSessionStripFor(
    markerId: string,
  ): MapSessionStripData | null {
    const marker = markers.value.find(m => m.id === markerId)
    if (!marker) return null

    interface Candidate extends Omit<MapSessionStripData, 'kind' | 'minutes'> {
      startMs: number
      endMs: number
    }
    const candidates: Candidate[] = []

    for (const e of schedule.value) {
      if (e.venueMarkerId !== markerId) continue
      candidates.push({
        source: e.category === 'activations' ? 'activations' : 'program',
        title: e.title,
        startMs: parseFestivalDate(e.start).getTime(),
        endMs: parseFestivalDate(e.end).getTime(),
        route: `/program/${e.id}`,
      })
    }

    for (const se of subEvents.value) {
      if (!sessionMatchesMarker(se.metadata.location, marker)) continue
      candidates.push({
        source: 'community',
        title: se.metadata.name,
        startMs: se.startTime * 1000,
        endMs: se.endTime * 1000,
        route: `/sessions/${se.address}`,
      })
    }
    if (!candidates.length) return null

    const now = Date.now()
    const ongoing = candidates
      .filter(c => c.startMs <= now && now < c.endMs)
      .sort((a, b) => a.endMs - b.endMs)[0]
    if (ongoing) {
      return { kind: 'ongoing', source: ongoing.source, title: ongoing.title, route: ongoing.route }
    }

    const upcoming = candidates
      .filter(c => c.startMs > now && c.startMs - now <= 60 * 60 * 1000)
      .sort((a, b) => a.startMs - b.startMs)[0]
    if (!upcoming) return null
    const minutes = Math.max(1, Math.round((upcoming.startMs - now) / 60_000))
    return { kind: 'soon', source: upcoming.source, title: upcoming.title, minutes, route: upcoming.route }
  }

  return {
    // state
    mode: _mode,
    blocks,
    markers,
    zones,
    activeFloorId,
    activeBlock,
    activeFloor,
    selectedMarkerId: _selectedMarkerId,
    selectedMarker,
    markersReady,
    userSpot: _userSpot,
    // actions
    select,
    clearSelection,
    placeSpot,
    removeSpot,
    enterBuilding,
    exitToOutdoor,
    switchFloor,
    // derived
    getSessionStripFor,
  }
}
