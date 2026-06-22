<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePoaps } from '~/composables/usePoaps'
import FestivalPoapBadge from '~/components/FestivalPoapBadge.vue'

const { poaps } = usePoaps()

const MAX_DISPLAY = 3
const displayedPoaps = computed(() => poaps.value.slice(0, MAX_DISPLAY))

// Track image URLs that failed to load so we render the skeleton instead of the
// iOS broken-image glyph. Keyed by URL (not POAP id) so a refreshed URL gets a
// fresh attempt.
const erroredUrls = ref<Set<string>>(new Set())
function onImageError(url: string) {
  erroredUrls.value = new Set(erroredUrls.value).add(url)
}
</script>

<template>
  <div v-if="poaps.length">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-text-and-icons-primary">Badge Collection</h3>
      <NuxtLink to="/my/badges" class="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-text-and-icons-primary">
        <ArrowRightIcon />
      </NuxtLink>
    </div>

    <!-- Badge thumbnails: up to 3, evenly filling the row -->
    <div class="grid grid-cols-3 gap-3">
      <NuxtLink
        v-for="poap in displayedPoaps"
        :key="`${poap.poapContract}-${poap.tokenId}`"
        :to="`/my/badge/${poap.tokenId}?contract=${poap.poapContract}`"
        class="min-w-0"
      >
        <div class="w-full aspect-square rounded-xl overflow-hidden">
          <FestivalPoapBadge
            v-if="poap.type === 'festival'"
            :address="poap.attendee"
          />
          <BadgeCanvas v-else-if="poap.badgePixels" :pixels="poap.badgePixels" :size="160" />
          <img
            v-else-if="poap.poapImageUrl && !erroredUrls.has(poap.poapImageUrl)"
            :key="poap.poapImageUrl"
            :src="poap.poapImageUrl"
            alt=""
            class="w-full h-full object-cover"
            @error="onImageError(poap.poapImageUrl!)"
          />
          <div v-else class="w-full h-full bg-surface-3 animate-pulse" />
        </div>
        <p class="text-xs text-text-muted mt-1.5 truncate text-center">{{ poap.sourceName }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
