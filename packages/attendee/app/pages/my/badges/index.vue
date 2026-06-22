<script setup lang="ts">
import { computed } from 'vue'
import { usePoaps } from '~/composables/usePoaps'
import { useOnboardingSeen } from '~/composables/useOnboardingSeen'
import FestivalPoapBadge from '~/components/FestivalPoapBadge.vue'

const router = useRouter()
const { poaps, festivalPoaps, subEventPoaps, collectibleSubEventPoaps, isLoading } = usePoaps()
const { has: hasSeenOnboarding } = useOnboardingSeen()

const orderedPoaps = computed(() => [...festivalPoaps.value, ...subEventPoaps.value])

function onCollectMore() {
  if (collectibleSubEventPoaps.value.length === 0 && !hasSeenOnboarding('receive-badge')) {
    router.push('/my/badges/welcome')
  } else {
    router.push('/program')
  }
}
</script>

<template>
  <div class="-mx-4 flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))]">
    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center shrink-0">
      <BackButton class="text-text-and-icons-primary" />
      <h1 class="flex-1 text-center text-base font-semibold text-white">Badge Collection</h1>
      <div class="w-10" />
    </div>

    <div v-if="isLoading" class="flex-1 flex items-center justify-center text-text-muted">
      Loading…
    </div>

    <div v-else-if="!poaps.length" class="flex-1 flex flex-col items-center justify-center px-4 text-center">
      <p class="text-text-muted text-sm">No badges yet.</p>
      <p class="text-text-muted text-xs mt-1">Check in to sessions to earn badges.</p>
    </div>

    <div v-else class="flex-1 px-4">
      <div class="grid grid-cols-3 gap-3">
        <NuxtLink
          v-for="poap in orderedPoaps"
          :key="`${poap.poapContract}-${poap.tokenId}`"
          :to="`/my/badge/${poap.tokenId}?contract=${poap.poapContract}`"
          class="flex flex-col items-center"
        >
          <div class="w-full aspect-square rounded-2xl overflow-hidden bg-white">
            <FestivalPoapBadge
              v-if="poap.type === 'festival'"
              :address="poap.attendee"
            />
            <img
              v-else-if="poap.poapImageUrl"
              :src="poap.poapImageUrl"
              :alt="`${poap.sourceName} badge`"
              class="w-full h-full object-cover"
            />
            <BadgeCanvas
              v-else-if="poap.badgePixels"
              :pixels="poap.badgePixels"
              :size="180"
              class="w-full h-full"
            />
          </div>
          <p class="text-xs text-white mt-2 text-center truncate w-full">{{ poap.sourceName }}</p>
        </NuxtLink>
      </div>
    </div>

    <!-- Sticky bottom CTA: pinned above the tab bar via the scroll area. -->
    <div class="sticky bottom-0 px-4 pt-3 pb-[calc(var(--safe-bottom)+16px)] bg-background">
      <button
        type="button"
        class="block w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold text-center"
        @click="onCollectMore"
      >
        Collect more Badges
      </button>
    </div>
  </div>
</template>
