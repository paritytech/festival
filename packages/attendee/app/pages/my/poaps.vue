<script setup lang="ts">
import { usePoaps } from '~/composables/usePoaps'

const { poaps, festivalPoaps, subEventPoaps, isLoading } = usePoaps()
</script>

<template>
  <div class="-mx-4">
    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center">
      <BackButton class="text-text-and-icons-primary" />
      <h1 class="flex-1 text-center text-base font-semibold text-white">Badge Collection</h1>
      <div class="w-10" />
    </div>

    <div v-if="isLoading" class="text-center py-12 text-text-muted">Loading…</div>

    <div v-else-if="!poaps.length" class="px-4 py-12 text-center">
      <p class="text-text-muted text-sm">No badges yet.</p>
      <p class="text-text-muted text-xs mt-1">Check in to sessions to earn badges.</p>
    </div>

    <div v-else class="px-4">
      <!-- Festival POAP (hero, centered) -->
      <div v-if="festivalPoaps.length" class="flex flex-col items-center mb-6">
        <NuxtLink
          v-for="poap in festivalPoaps"
          :key="poap.tokenId"
          :to="`/my/badge/${poap.tokenId}?contract=${poap.poapContract}`"
          class="flex flex-col items-center"
        >
          <div class="w-[40vw] max-w-[180px] aspect-square rounded-2xl overflow-hidden bg-white">
            <img
              v-if="poap.poapImageUrl"
              :src="poap.poapImageUrl"
              alt="Festival badge"
              class="w-full h-full object-cover"
            />
            <BadgeCanvas
              v-else-if="poap.badgePixels"
              :pixels="poap.badgePixels"
              :size="180"
              class="w-full h-full"
            />
          </div>
          <p class="text-xs text-white mt-2 text-center">{{ poap.sourceName }}</p>
        </NuxtLink>
      </div>

      <!-- Session POAPs (responsive grid) -->
      <div v-if="subEventPoaps.length" class="grid grid-cols-3 gap-3">
        <NuxtLink
          v-for="poap in subEventPoaps"
          :key="poap.tokenId"
          :to="`/my/badge/${poap.tokenId}?contract=${poap.poapContract}`"
          class="flex flex-col items-center"
        >
          <div class="w-full aspect-square rounded-2xl overflow-hidden bg-white">
            <BadgeCanvas
              v-if="poap.badgePixels"
              :pixels="poap.badgePixels"
              :size="180"
              class="w-full h-full"
            />
            <img
              v-else-if="poap.poapImageUrl"
              :src="poap.poapImageUrl"
              alt="Session badge"
              class="w-full h-full object-cover"
            />
          </div>
          <p class="text-xs text-white mt-2 text-center truncate w-full">{{ poap.sourceName }}</p>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
