<script setup lang="ts">
</script>

<template>
  <NuxtLink
    to="/chat"
    class="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 cursor-pointer"
    data-testid="home-festival-chat"
  >
    <div class="w-10 h-10 shrink-0 flex items-center justify-center">
      <img src="/question-answer.svg" alt="" aria-hidden="true" class="w-7 h-7" />
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-base font-semibold text-text-and-icons-primary leading-snug">
        Have a question?
      </p>
      <p class="text-base font-semibold text-text-and-icons-primary leading-snug">
        Ask the festival chat
      </p>
    </div>
    <div
      class="w-9 h-9 shrink-0 rounded-full bg-surface-3 flex items-center justify-center text-text-and-icons-primary"
    >
      <ArrowRightIcon />
    </div>
  </NuxtLink>
</template>
