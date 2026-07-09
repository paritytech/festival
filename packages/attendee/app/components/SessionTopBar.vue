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
    <IconButton
      shape="square"
      class="-ml-2"
      :data-testid="backTestid"
      :aria-label="backAriaLabel"
      @click="$emit('back')"
    >
      <BackIcon />
    </IconButton>

    <h1
      class="absolute left-1/2 -translate-x-1/2 text-base font-semibold text-text-and-icons-primary"
      :data-testid="titleTestid"
    >
      {{ title }}
    </h1>

    <div class="flex items-center gap-2 -mr-2">
      <slot name="trailing" />
    </div>
  </div>
</template>
