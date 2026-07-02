<script setup lang="ts">
import { computed } from 'vue'

type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    size?: Size
    /** Accessible label for screen readers. */
    label?: string
  }>(),
  { size: 'md', label: 'Loading' },
)

// Colour comes from the current text color (`border-current`); set a `text-*`
// class on the element to recolour, e.g. <Spinner class="text-fg-primary" />.
const SIZE: Record<Size, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
}

const classes = computed(() => [
  SIZE[props.size],
  'shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin',
])
</script>

<template>
  <div role="status" :aria-label="label" :class="classes" />
</template>
