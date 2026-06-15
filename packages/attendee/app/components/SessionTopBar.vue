<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    titleTestid?: string
    backTestid?: string
    backAriaLabel?: string
  }>(),
  { backAriaLabel: 'Back' },
)

defineEmits<{ back: [] }>()
</script>

<template>
  <div class="relative flex items-center justify-between px-4 pt-4 pb-3">
    <button
      type="button"
      class="w-10 h-10 flex items-center justify-center -ml-2 text-text-and-icons-primary"
      :data-testid="backTestid"
      :aria-label="backAriaLabel"
      @click="$emit('back')"
    >
      <BackIcon />
    </button>

    <h1
      class="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-white"
      :data-testid="titleTestid"
    >
      {{ title }}
    </h1>

    <div class="flex items-center gap-2 -mr-2">
      <slot name="trailing" />
    </div>
  </div>
</template>
