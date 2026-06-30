<script setup lang="ts">
import { computed } from 'vue'
import { useSwipeBack } from '~/composables/useSwipeBack'

const { container, offsetX, isGesturing } = useSwipeBack()

const progress = computed(() => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1
  return Math.min(1, offsetX.value / w)
})

const scrimOpacity = computed(() =>
  offsetX.value > 0 ? 0.15 * (1 - progress.value) : 0
)

const shadowOpacity = computed(() =>
  offsetX.value > 0 ? 0.12 * (1 - progress.value) : 0
)
</script>

<template>
  <div ref="container" class="relative overflow-x-hidden">
    <!-- Scrim: darkens background behind the sliding page -->
    <div
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-40 bg-bg-surface-main pointer-events-none"
      :style="{ opacity: scrimOpacity }"
    />

    <!-- Sliding content wrapper -->
    <div
      class="relative z-50 min-h-screen bg-bg-surface-main"
      :style="{
        transform: `translateX(${offsetX}px)`,
        boxShadow: offsetX > 0
          ? `-8px 0 20px rgba(0, 0, 0, ${shadowOpacity})`
          : 'none',
      }"
    >
      <slot />
    </div>
  </div>
</template>
