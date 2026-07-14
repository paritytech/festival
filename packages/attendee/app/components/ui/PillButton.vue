<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'idle' | 'active' | 'filled' | 'outlined'
type Tone = 'surface' | 'glass'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    tone?: Tone
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  {
    variant: 'idle',
    tone: 'surface',
    size: 'lg',
    type: 'button',
    disabled: false,
  },
)

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-20 h-12'
    case 'md':
      return 'px-7 py-[14px]'
    case 'lg':
      return 'px-8 py-[18px]'
  }
})

const variantClasses = computed(() => {
  if (props.variant === 'outlined') {
    return 'bg-bg-surface-main text-text-and-icons-primary ring-1 ring-inset ring-stroke-primary'
  }
  if (props.variant === 'filled') {
    return 'bg-fill-24 text-text-and-icons-primary'
  }
  if (props.variant === 'active') {
    return 'bg-fill-6 text-text-and-icons-secondary ring-1 ring-inset ring-text-and-icons-primary'
  }
  if (props.tone === 'glass') {
    return 'bg-fill-12 text-text-and-icons-primary'
  }
  return 'bg-bg-surface-nested text-text-and-icons-primary'
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex flex-col items-center justify-center rounded-xl text-base leading-5 font-normal text-center transition-colors disabled:cursor-not-allowed"
    :class="[sizeClasses, variantClasses]"
  >
    <slot />
  </button>
</template>
