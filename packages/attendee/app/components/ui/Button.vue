<script setup lang="ts">
import { computed } from 'vue'

type Variant =
  | 'primary' // light design-system action button (#DADBE0)
  | 'brand' // dark festival stone button (#57534e)
  | 'secondary'
  | 'danger' // solid error
  | 'danger-subtle' // low-emphasis error (tinted bg + error text)
  | 'ghost' // text-only
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    block?: boolean
    /** When set, renders a <NuxtLink>; otherwise a <button>. */
    to?: import('vue-router').RouteLocationRaw
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    block: false,
    type: 'button',
    disabled: false,
    loading: false,
  },
)

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-bg-action-primary text-fg-primary-inverted hover:bg-bg-action-primary-hover font-semibold',
  brand:
    'bg-primary text-text-and-icons-primary hover:bg-primary-hover font-semibold',
  secondary:
    'bg-fill-12 text-text-and-icons-primary hover:bg-fill-18 font-medium',
  danger:
    'bg-bg-status-error text-text-and-icons-primary hover:bg-bg-status-error-hover font-semibold',
  'danger-subtle': 'bg-bg-status-error/10 text-fg-error font-semibold',
  ghost: 'text-text-and-icons-primary hover:bg-fill-6 font-medium',
}

const SIZE: Record<Size, string> = {
  sm: 'px-4 py-2.5 text-sm rounded-xl',
  md: 'px-5 py-4 text-sm rounded-2xl',
  lg: 'px-6 py-[18px] text-base rounded-2xl',
}

const isDisabled = computed(() => props.disabled || props.loading)
// Render a link only when `to` is set and interactive; a disabled link falls
// back to an inert <button>.
const tag = computed(() => (props.to != null && !isDisabled.value ? 'NuxtLink' : 'button'))

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 text-center transition-colors disabled:opacity-50 disabled:pointer-events-none',
  SIZE[props.size],
  VARIANT[props.variant],
  props.block && 'w-full',
])
</script>

<template>
  <!-- Single root so $attrs (class, @click, data-testid, …) fall through. -->
  <component
    :is="tag"
    :to="tag === 'NuxtLink' ? to : undefined"
    :type="tag === 'button' ? type : undefined"
    :disabled="tag === 'button' ? isDisabled : undefined"
    :aria-busy="loading || undefined"
    :class="classes"
  >
    <Spinner v-if="loading" size="sm" aria-hidden="true" />
    <slot />
  </component>
</template>
