<script setup lang="ts">
import IconEdit from '~icons/ic/round-mode-edit'

// Edit affordance (round-mode-edit). Renders a NuxtLink when `to` is provided,
// otherwise a button. Color and layout are owned by the call site via class;
// `size` controls the glyph dimensions in px.
withDefaults(
  defineProps<{
    ariaLabel: string
    to?: string
    size?: number
  }>(),
  { size: 24 },
)
</script>

<template>
  <NuxtLink v-if="to" :to="to" :aria-label="ariaLabel">
    <IconEdit :style="{ width: `${size}px`, height: `${size}px` }" />
  </NuxtLink>
  <button v-else type="button" :aria-label="ariaLabel">
    <IconEdit :style="{ width: `${size}px`, height: `${size}px` }" />
  </button>
</template>
