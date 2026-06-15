<script setup lang="ts">
import { useSchedule } from '~/composables/useSchedule'
import { useBookmarks } from '~/composables/useBookmarks'
import { useFestival } from '~/composables/useFestival'
import { getMarkerLocationLabel } from '@festival/shared/venue/floors'
import { formatDateTimeBerlin, parseFestivalDate } from '@festival/shared/utils/time'

const route = useRoute()
const id = route.params.id as string
const { getById } = useSchedule()
const { toggleBookmark, isBookmarked } = useBookmarks()
const { metadata } = useFestival()

const venueMarkers = computed(() => metadata.value?.venueMap?.markers ?? [])

const entry = getById(id)

function formatDateTime(iso: string) {
  return formatDateTimeBerlin(iso)
}

function handleToggle() {
  if (!entry) return
  const location = entry.venueMarkerId
    ? getMarkerLocationLabel(entry.venueMarkerId, venueMarkers.value)
    : undefined
  toggleBookmark(entry.id, {
    startMs: parseFestivalDate(entry.start).getTime(),
    title: entry.title,
    deeplink: `/#/program/${entry.id}`,
    location: location || undefined,
  })
}
</script>

<template>
  <div v-if="!entry" class="text-center py-12">
    <p class="text-text-muted">Session not found.</p>
    <NuxtLink to="/schedule" class="text-primary text-sm mt-2 inline-block">Back to schedule</NuxtLink>
  </div>

  <div v-else>
    <NuxtLink to="/schedule" class="text-xs text-text-muted hover:text-text-secondary mb-4 block">
      ← Back to Schedule
    </NuxtLink>

    <div class="flex items-start justify-between mb-2">
      <h2 class="font-heading text-2xl font-bold">{{ entry.title }}</h2>
      <button
        class="text-2xl shrink-0 ml-3"
        :class="isBookmarked(entry.id) ? 'text-yellow-500' : 'text-text-muted'"
        @click="handleToggle"
      >
        {{ isBookmarked(entry.id) ? '★' : '☆' }}
      </button>
    </div>

    <div class="flex items-center gap-2 mb-4">
      <span class="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded font-medium">
        Official
      </span>
    </div>

    <p class="text-text-secondary text-sm mb-6">{{ entry.description }}</p>

    <div class="bg-surface border border-border rounded-md p-4 space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-text-muted text-xs">Start</p>
          <p>{{ formatDateTime(entry.start) }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">End</p>
          <p>{{ formatDateTime(entry.end) }}</p>
        </div>
        <div v-if="entry.speakers.length">
          <p class="text-text-muted text-xs">Speakers</p>
          <p class="break-words">{{ entry.speakers.join(', ') }}</p>
        </div>
        <div v-if="entry.venueMarkerId">
          <p class="text-text-muted text-xs">Location</p>
          <p>{{ getMarkerLocationLabel(entry.venueMarkerId!, venueMarkers) }}</p>
        </div>
      </div>

      <!-- Deep link to map -->
      <NuxtLink
        v-if="entry.venueMarkerId"
        :to="`/map?marker=${entry.venueMarkerId}`"
        class="flex items-center gap-2 px-4 py-2.5 bg-primary/10 text-primary rounded-md text-sm font-medium hover:bg-primary/15 transition-colors"
      >
        <span>🗺️</span>
        <span>View on Map</span>
      </NuxtLink>
    </div>
  </div>
</template>
