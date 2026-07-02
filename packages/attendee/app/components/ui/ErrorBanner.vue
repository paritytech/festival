<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'danger' | 'warning'
type Size = 'sm' | 'md'

const props = withDefaults(
  defineProps<{
    /** Message text. Alternatively provide default-slot content. */
    message?: string
    variant?: Variant
    size?: Size
  }>(),
  { variant: 'danger', size: 'md' },
)

const CONTAINER: Record<Variant, string> = {
  danger: 'bg-danger-muted border-stroke-error/20',
  warning: 'bg-warning-muted border-stroke-warning/20',
}

const TEXT: Record<Variant, string> = {
  danger: 'text-fg-error',
  warning: 'text-fg-warning',
}

const SIZE: Record<Size, string> = {
  sm: 'px-4 py-3',
  md: 'px-5 py-4',
}

const containerClasses = computed(() => [
  'rounded-2xl border',
  SIZE[props.size],
  CONTAINER[props.variant],
])
</script>

<template>
  <div :class="containerClasses" role="alert">
    <p :class="['text-sm', TEXT[variant]]">
      <slot>{{ message }}</slot>
    </p>
  </div>
</template>
