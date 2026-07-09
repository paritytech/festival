<script setup lang="ts">
import { computed } from 'vue'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'plain' | 'surface'
type Shape = 'circle' | 'square'

const props = withDefaults(
  defineProps<{
    size?: Size
    variant?: Variant
    shape?: Shape
    /** When set, renders a <NuxtLink>; otherwise a <button>. */
    to?: import('vue-router').RouteLocationRaw
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  {
    size: 'md',
    variant: 'plain',
    shape: 'circle',
    type: 'button',
    disabled: false,
  },
)

const SIZE: Record<Size, string> = {
  sm: 'w-9 h-9',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
}

const VARIANT: Record<Variant, string> = {
  plain: '',
  surface: 'bg-bg-surface-nested',
}

const tag = computed(() => (props.to != null && !props.disabled ? 'NuxtLink' : 'button'))

const classes = computed(() => [
  'inline-flex items-center justify-center shrink-0 text-text-and-icons-primary transition-colors disabled:opacity-50 disabled:pointer-events-none',
  SIZE[props.size],
  VARIANT[props.variant],
  props.shape === 'circle' ? 'rounded-full' : 'rounded-xl',
])
</script>

<template>
  <!-- Single root so $attrs (aria-label, class, @click, data-testid, …) fall through.
       Callers MUST pass an `aria-label` since these are icon-only. -->
  <component
    :is="tag"
    :to="tag === 'NuxtLink' ? to : undefined"
    :type="tag === 'button' ? type : undefined"
    :disabled="tag === 'button' ? disabled : undefined"
    :class="classes"
  >
    <slot />
  </component>
</template>
