<script setup lang="ts">
withDefaults(defineProps<{
  steps: number
  currentStep: number
  variant?: 'light' | 'dark'
}>(), { steps: 3, currentStep: 1, variant: 'light' })
</script>

<template>
  <div class="flex gap-2">
    <div
      v-for="i in steps"
      :key="i"
      class="flex-1 h-0.5 rounded-full transition-colors"
      :class="variant === 'light'
        ? (i <= currentStep ? 'bg-white' : 'bg-fill-18')
        : (i <= currentStep ? 'bg-black' : 'bg-black/15')"
    />
  </div>
</template>
