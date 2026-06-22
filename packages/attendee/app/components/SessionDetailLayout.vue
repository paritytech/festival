<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { VenueMarker, VenueZone } from '@festival/shared/metadata/schemas'

const props = defineProps<{
  badgePixels?: number[] | null
  imageUrl?: string | null
  bannerValue?: string
  bannerLabel?: string
  category?: string
  categoryColor?: string
  title: string
  description?: string
  dayLabel?: string
  timeRange: string
  locationLabel?: string
  location?: string | null
  venueMarkers: VenueMarker[]
  venueZones: VenueZone[]
  // When defined, render a favorite-toggle star to the right of any
  // topBarTrailing content. Owners pass `null` to hide it.
  bookmarked?: boolean | null
  ongoing?: boolean
  ended?: boolean
  // Override the back button destination. Default is `router.back()` (browser
  // history pop); pages can pass a route here when history would land the user
  // somewhere unexpected (e.g. arriving from a create-flow success screen).
  backTo?: RouteLocationRaw
}>()

defineEmits<{
  'toggle-bookmark': []
  'open-location': []
}>()

const router = useRouter()

function onBack() {
  if (props.backTo) {
    router.push(props.backTo)
  } else {
    router.back()
  }
}
</script>

<template>
  <div
    class="flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] -mx-4"
  >
    <SessionTopBar
      title="Session Detail"
      title-testid="session-detail-title"
      back-testid="session-detail-back"
      @back="onBack"
    >
      <template #trailing>
        <slot name="topBarTrailing" />
        <button
          v-if="bookmarked != null"
          class="w-10 h-10 flex items-center justify-center text-text-and-icons-primary"
          :aria-pressed="bookmarked"
          aria-label="Toggle favorite"
          data-testid="session-favorite-toggle"
          @click="$emit('toggle-bookmark')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            :fill="bookmarked ? 'currentColor' : 'none'"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </template>
    </SessionTopBar>

    <!-- Top image tile + ongoing/ended indicator -->
    <div
      v-if="badgePixels || imageUrl || ongoing || ended"
      class="px-4 pt-2 flex items-start justify-between"
    >
      <div
        v-if="badgePixels || imageUrl"
        class="w-20 h-20 rounded-xl overflow-hidden bg-surface"
      >
        <BadgeCanvas
          v-if="badgePixels"
          :pixels="badgePixels"
          :size="80"
        />
        <img
          v-else-if="imageUrl"
          :src="imageUrl"
          alt=""
          class="w-full h-full object-cover"
        />
      </div>
      <span
        v-if="ongoing"
        class="ml-auto flex items-center gap-1.5 text-sm font-medium text-danger"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-danger" />
        Ongoing
      </span>
      <span
        v-else-if="ended"
        class="ml-auto text-sm font-medium text-text-and-icons-secondary"
      >
        Ended Session
      </span>
    </div>

    <!-- Banner -->
    <div
      v-if="bannerLabel"
      class="flex items-center justify-between gap-3 px-4 py-3 bg-surface mt-6"
    >
      <div class="min-w-0 flex-1">
        <p class="text-xs text-text-muted">{{ bannerLabel }}</p>
        <p class="text-sm font-medium text-text-and-icons-primary mt-0.5 break-words">{{ bannerValue }}</p>
      </div>
      <div
        v-if="category"
        class="flex items-center gap-1 shrink-0"
      >
        <span
          class="w-1 h-3 rounded-full"
          :style="{ background: categoryColor ?? '#ffffff' }"
        />
        <span class="text-sm font-medium text-text-and-icons-primary capitalize">{{ category }}</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 px-4 pt-4 pb-6">
      <h1 class="text-xl font-semibold text-text-and-icons-primary leading-tight" data-testid="session-detail-heading">{{ title }}</h1>

      <p
        v-if="description"
        class="text-text-and-icons-secondary text-sm leading-relaxed mt-2"
      >
        {{ description }}
      </p>

      <!-- When -->
      <div class="mt-6">
        <p class="text-text-muted text-xs leading-[18px]">{{ dayLabel ? 'Date & Time' : 'Time' }}</p>
        <p
          v-if="dayLabel"
          class="text-2xl font-semibold mt-0.5"
          :class="ended ? 'text-text-and-icons-secondary' : 'text-text-and-icons-primary'"
        >
          {{ dayLabel }}
        </p>
        <p
          class="text-2xl font-semibold"
          :class="[ended ? 'text-text-and-icons-secondary' : 'text-text-and-icons-primary', { 'mt-0.5': !dayLabel }]"
        >
          {{ timeRange }}<span v-if="ended"> Ended</span>
        </p>
      </div>

      <!-- Selected Location -->
      <div v-if="locationLabel" class="mt-5">
        <p class="text-text-muted text-xs leading-[18px]">Selected Location</p>
        <p
          class="text-2xl font-semibold mt-0.5"
          :class="ended ? 'text-text-and-icons-secondary' : 'text-text-and-icons-primary'"
        >
          {{ locationLabel }}
        </p>
        <div v-if="location" class="mt-6">
          <button
            type="button"
            class="block w-full text-left"
            data-testid="session-location-map-link"
            aria-label="Open session location"
            @click="$emit('open-location')"
          >
            <SessionLocationMap :location="location" :markers="venueMarkers" :zones="venueZones" />
          </button>
        </div>
      </div>
    </div>

    <!-- Inline secondary actions (e.g. Report) scroll with the content. -->
    <div v-if="$slots.secondaryAction" class="px-4 pb-3">
      <slot name="secondaryAction" />
    </div>

    <div class="sticky bottom-0 px-4 pt-3 pb-[calc(var(--safe-bottom)+16px)] bg-background">
      <slot name="aboveAction" />
      <slot name="action" />
    </div>
  </div>
</template>
