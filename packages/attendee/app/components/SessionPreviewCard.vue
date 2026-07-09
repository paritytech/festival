<script setup lang="ts">
import { computed } from 'vue'
import { decodeBadgeHex } from '@festival/shared/utils/badge'
import { truncate } from '@festival/shared/utils/text'

const PREVIEW_NAME_MAX_CHARS = 32

const props = defineProps<{
  name: string
  startTime: string
  endTime: string
  locationLabel?: string
  badgeHex?: string
}>()

const badgePixels = computed(() => {
  if (!props.badgeHex) return null
  return decodeBadgeHex(props.badgeHex)
})

const displayName = computed(() => truncate(props.name, PREVIEW_NAME_MAX_CHARS))
</script>

<template>
  <div
    data-testid="session-preview-card"
    class="rounded-2xl bg-surface-2 px-6 pt-6 pb-5 flex flex-col items-center text-center"
  >
    <div v-if="badgePixels" class="w-[52%] aspect-square rounded-2xl overflow-hidden">
      <BadgeCanvas :pixels="badgePixels" :size="128" />
    </div>

    <p class="text-[18px] leading-[22px] font-semibold text-white mt-5">{{ displayName }}</p>

    <p class="text-xs text-white/50 mt-2">
      {{ startTime }} - {{ endTime }}
      <span v-if="locationLabel">&ensp;{{ locationLabel }}</span>
    </p>
  </div>
</template>
