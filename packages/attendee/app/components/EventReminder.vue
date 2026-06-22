<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleEntry, VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'
import { resolveShortLocationLabel } from '@festival/shared/venue/floors'
import { formatTimeBerlin, toBerlinDateKey, parseFestivalDate } from '@festival/shared/utils/time'

const props = withDefaults(defineProps<{
  entries: ScheduleEntry[]
  venueMarkers: VenueMarker[]
  venueZones: VenueZone[]
  now: number
  festivalName?: string
}>(), {
  festivalName: 'Web3 Summit',
})

type ReminderState =
  | { type: 'hidden' }
  | { type: 'ongoing'; entry: ScheduleEntry }
  | { type: 'next-min'; entry: ScheduleEntry; minutes: number }
  | { type: 'next-at'; entry: ScheduleEntry; time: string }
  | { type: 'pre-festival'; entry: ScheduleEntry; days: number; hours: number; minutes: number }

const state = computed<ReminderState>(() => {
  const { entries, now } = props
  if (!entries.length) return { type: 'hidden' }

  const nowBerlin = toBerlinDateKey(new Date(now))

  // All unique schedule dates (Berlin), sorted
  const allDates = [...new Set(
    entries.map(e => toBerlinDateKey(e.start)),
  )].sort()

  // Before festival starts entirely → countdown to first entry
  if (nowBerlin < allDates[0]) {
    const first = [...entries].sort(
      (a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime(),
    )[0]
    const diffMs = parseFestivalDate(first.start).getTime() - now
    const totalMinutes = Math.max(Math.floor(diffMs / 60_000), 0)
    const days = Math.floor(totalMinutes / (60 * 24))
    const hours = Math.floor((totalMinutes - days * 60 * 24) / 60)
    const minutes = totalMinutes - days * 60 * 24 - hours * 60
    return { type: 'pre-festival', entry: first, days, hours, minutes }
  }

  // Ongoing sessions (start <= now < end)
  const ongoing = entries
    .filter(e => parseFestivalDate(e.start).getTime() <= now && parseFestivalDate(e.end).getTime() > now)
    .sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime())

  if (ongoing.length) {
    return { type: 'ongoing', entry: ongoing[0] }
  }

  // Future sessions sorted by start
  const future = entries
    .filter(e => parseFestivalDate(e.start).getTime() > now)
    .sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime())

  // Today's entries (by Berlin date)
  const todayEntries = entries.filter(
    e => toBerlinDateKey(e.start) === nowBerlin,
  )

  // If today has sessions, check if we're past the last one
  if (todayEntries.length) {
    const lastEnd = Math.max(...todayEntries.map(e => parseFestivalDate(e.end).getTime()))
    if (now > lastEnd) return { type: 'hidden' }
  }

  if (!future.length) return { type: 'hidden' }

  const next = future[0]
  const nextBerlin = toBerlinDateKey(next.start)

  // Next session is not today → hidden (day is over or gap day)
  if (nextBerlin !== nowBerlin) return { type: 'hidden' }

  const diffMin = Math.floor((parseFestivalDate(next.start).getTime() - now) / 60_000)

  if (diffMin < 30) {
    return { type: 'next-min', entry: next, minutes: Math.max(diffMin, 1) }
  }

  return { type: 'next-at', entry: next, time: formatTimeBerlin(next.start) }
})

const statusLabel = computed(() => {
  const s = state.value
  if (s.type === 'ongoing') return 'Ongoing'
  if (s.type === 'next-min') return `Next in ${s.minutes} min`
  if (s.type === 'next-at') return `Next at ${s.time}`
  return ''
})

const countdownLabel = computed(() => {
  const s = state.value
  if (s.type !== 'pre-festival') return ''
  if (s.days >= 1) {
    return `${pad(s.days)} Day${s.days === 1 ? '' : 's'} ${pad(s.hours)} Hour${s.hours === 1 ? '' : 's'}`
  }
  if (s.hours >= 1) {
    return `${pad(s.hours)} Hour${s.hours === 1 ? '' : 's'} ${pad(s.minutes)} Minute${s.minutes === 1 ? '' : 's'}`
  }
  return `${pad(s.minutes)} Minute${s.minutes === 1 ? '' : 's'}`
})

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

const locationLabel = computed(() => {
  const s = state.value
  if (s.type === 'hidden') return ''
  if (!s.entry.venueMarkerId) return ''
  return resolveShortLocationLabel(s.entry.venueMarkerId, props.venueMarkers, props.venueZones)
})

const entry = computed(() =>
  state.value.type !== 'hidden' ? state.value.entry : null,
)
</script>

<template>
  <div
    v-if="state.type === 'pre-festival'"
    class="rounded-2xl bg-surface-2 p-4"
    data-testid="event-reminder-pre-festival"
  >
    <div class="flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
      <span class="text-xs font-semibold text-danger uppercase tracking-wide">
        DON'T MISS {{ festivalName.toUpperCase() }}!
      </span>
    </div>
    <p class="text-base font-semibold text-white mt-1.5 leading-snug">
      Starts in: {{ countdownLabel }}
    </p>
  </div>

  <NuxtLink
    v-else-if="entry"
    :to="`/program/${entry.id}`"
    class="block rounded-2xl bg-surface-2 p-4"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <span
          v-if="state.type === 'ongoing'"
          class="w-1.5 h-1.5 rounded-full bg-danger shrink-0"
        />
        <span
          class="text-xs font-medium"
          :class="state.type === 'ongoing' ? 'text-danger' : 'text-text-muted'"
        >
          {{ statusLabel }}
        </span>
      </div>
      <span v-if="locationLabel" class="text-xs text-text-muted">
        {{ locationLabel }}
      </span>
    </div>
    <p class="text-base font-semibold text-white mt-1.5 leading-snug">
      {{ entry.title }}
    </p>
  </NuxtLink>
</template>
