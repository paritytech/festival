<script setup lang="ts">
defineEmits<{
  continue: []
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center flex-1 px-6 py-8">
    <img
      src="/badge-illustration.svg"
      alt="Pixel badge examples"
      class="w-64 h-auto mb-8"
    />

    <h2 class="text-2xl font-bold text-text-and-icons-primary text-center mb-10 max-w-[300px]">
      Design a badge that represents you
    </h2>

    <button
      data-testid="badge-intro-create"
      class="w-full py-4 bg-bg-action-primary text-fg-primary-inverted rounded-2xl text-sm font-semibold"
      @click="$emit('continue')"
    >
      Create Badge
    </button>
  </div>
</template>
