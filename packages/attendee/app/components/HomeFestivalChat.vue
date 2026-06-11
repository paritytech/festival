<script setup lang="ts">
</script>

<template>
  <NuxtLink
    to="/chat"
    class="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 cursor-pointer"
    data-testid="home-festival-chat"
  >
    <div class="w-10 h-10 shrink-0 flex items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 4h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2.5l-3 3v-3H7l-2 2V6a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
          class="text-text-and-icons-primary"
        />
        <path
          d="M9 8h6M9 11h4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          class="text-text-and-icons-primary"
        />
      </svg>
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
      class="w-9 h-9 shrink-0 rounded-full bg-surface-3 flex items-center justify-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-text-and-icons-primary"
        aria-hidden="true"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </div>
  </NuxtLink>
</template>
