<script setup lang="ts">
import { computed } from 'vue'
import { useFestival } from '~/composables/useFestival'
import { openUrl } from '@festival/shared/host/navigation'

const { metadata } = useFestival()

const DEFAULT_NAME = 'Funkhaus Berlin'
const DEFAULT_ADDRESS = 'Nalepastraße 18, 12459 Berlin, Germany'

const parsed = computed(() => {
  const loc = metadata.value?.location
  if (loc && typeof loc === 'object') {
    const venue = typeof loc.venue === 'string' ? loc.venue.trim() : ''
    const address = typeof loc.address === 'string' ? loc.address.trim() : ''
    if (venue || address) {
      return {
        name: venue || DEFAULT_NAME,
        address: address || DEFAULT_ADDRESS,
      }
    }
  }
  return { name: DEFAULT_NAME, address: DEFAULT_ADDRESS }
})

async function openInMaps() {
  const { name, address } = parsed.value
  const query = address ? `${name}, ${address}` : name
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  await openUrl(url)
}
</script>

<template>
  <button
    type="button"
    class="w-full flex items-stretch gap-3 rounded-2xl bg-bg-surface-container p-3 text-left cursor-pointer"
    data-testid="home-location"
    @click="openInMaps"
  >
    <div class="flex-1 min-w-0 py-1">
      <p class="text-base font-semibold text-text-and-icons-primary">Venue Location</p>
      <p class="text-sm text-text-and-icons-secondary mt-1 leading-snug">
        {{ parsed.name }}<template v-if="parsed.address">,</template>
      </p>
      <p v-if="parsed.address" class="text-sm text-text-and-icons-secondary leading-snug">

        {{ parsed.address }}
      </p>
    </div>
    <img
      src="/map-placeholder.png"
      alt=""
      aria-hidden="true"
      class="w-28 h-16 rounded-xl object-cover shrink-0 self-center"
    />
  </button>
</template>
