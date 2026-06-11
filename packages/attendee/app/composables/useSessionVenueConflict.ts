import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import type { VenueMarker } from '@festival/shared/metadata/schemas'
import type { PickedLocation } from '@festival/shared/venue/floors'
import { SESSION_LOCATION_ALLOWED_TYPES } from '@festival/shared/venue/categories'
import {
  findVenueConflict,
  findBusyMarkerIds,
  type VenueConflictItem,
} from '@festival/shared/sessions/venueConflict'
import { berlinMinuteToDate } from '@festival/shared'
import { useSubEvents } from './useSubEvents'
import { useSchedule } from './useSchedule'

interface Options {
  dateKey: MaybeRefOrGetter<string>
  startMinutesOfDay: MaybeRefOrGetter<number | null>
  endMinutesOfDay: MaybeRefOrGetter<number | null>
  venueMarkers: MaybeRefOrGetter<VenueMarker[]>
  pickedLocation: MaybeRefOrGetter<PickedLocation | null>
  /** Sub-event address to exclude (the one being edited). */
  excludeAddress?: string
}

export function useSessionVenueConflict(opts: Options) {
  const { subEvents } = useSubEvents()
  const { entries: scheduleEntries } = useSchedule()

  const candidateWindow = computed<{ startSec: number; endSec: number } | null>(() => {
    const dateKey = toValue(opts.dateKey)
    const startMin = toValue(opts.startMinutesOfDay)
    const endMin = toValue(opts.endMinutesOfDay)
    if (!dateKey || startMin == null || endMin == null) return null
    const startSec = Math.floor(berlinMinuteToDate(dateKey, startMin).getTime() / 1000)
    const endSec = Math.floor(berlinMinuteToDate(dateKey, endMin).getTime() / 1000)
    return { startSec, endSec }
  })

  const allowedMarkerIds = computed(() =>
    toValue(opts.venueMarkers)
      .filter((m) => SESSION_LOCATION_ALLOWED_TYPES.has(m.type))
      .map((m) => m.id),
  )

  const busyMarkerIds = computed<Set<string>>(() => {
    const w = candidateWindow.value
    if (!w) return new Set()
    return findBusyMarkerIds(
      w.startSec,
      w.endSec,
      allowedMarkerIds.value,
      subEvents.value,
      scheduleEntries.value,
      toValue(opts.venueMarkers),
      opts.excludeAddress,
    )
  })

  function detectConflict(): VenueConflictItem | null {
    const picked = toValue(opts.pickedLocation)
    const w = candidateWindow.value
    if (!picked?.markerId || !w) return null
    return findVenueConflict(
      picked.markerId,
      w.startSec,
      w.endSec,
      subEvents.value,
      scheduleEntries.value,
      toValue(opts.venueMarkers),
      opts.excludeAddress,
    )
  }

  const conflictError = ref<string | null>(null)

  function setConflictError(c: VenueConflictItem) {
    conflictError.value = `That venue is already booked by "${c.title}" for this time. Pick a different spot or time.`
  }

  watch(
    () => [
      toValue(opts.pickedLocation)?.markerId ?? null,
      toValue(opts.dateKey),
      toValue(opts.startMinutesOfDay),
      toValue(opts.endMinutesOfDay),
    ],
    () => {
      conflictError.value = null
    },
  )

  return {
    candidateWindow,
    busyMarkerIds,
    detectConflict,
    conflictError,
    setConflictError,
  }
}
