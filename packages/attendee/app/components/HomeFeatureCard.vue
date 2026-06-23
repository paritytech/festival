<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * Home "feature" card (Host / Build / Collect). Two states share one layout:
 *  - locked   (no `to`): dimmed with a dark overlay and a lock badge
 *  - unlocked (`to` set): a NuxtLink with a plus badge
 */
defineProps<{
  bg: string
  accent: string
  image: string
  imageClass: string
  title: string
  subtitle: string
  to?: RouteLocationRaw
}>()
</script>

<template>
  <component
    :is="to ? 'NuxtLink' : 'div'"
    :to="to"
    class="block rounded-3xl relative overflow-hidden"
    :class="bg"
  >
    <div
      class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
    >
      <svg
        v-if="!to"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M18 8.5H17V6.5C17 3.74 14.76 1.5 12 1.5C9.24 1.5 7 3.74 7 6.5V8.5H6C4.9 8.5 4 9.4 4 10.5V20.5C4 21.6 4.9 22.5 6 22.5H18C19.1 22.5 20 21.6 20 20.5V10.5C20 9.4 19.1 8.5 18 8.5ZM12 17.5C10.9 17.5 10 16.6 10 15.5C10 14.4 10.9 13.5 12 13.5C13.1 13.5 14 14.4 14 15.5C14 16.6 13.1 17.5 12 17.5ZM9 8.5V6.5C9 4.84 10.34 3.5 12 3.5C13.66 3.5 15 4.84 15 6.5V8.5H9Z"
          :fill="accent"
        />
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        :stroke="accent"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </div>
    <img :src="image" :class="imageClass" alt="" />
    <div class="relative z-[1] p-3 pr-[50%]">
      <p class="text-2xl font-semibold text-text-and-icons-primary">
        {{ title }}
      </p>
      <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
        {{ subtitle }}
      </p>
    </div>
    <div
      v-if="!to"
      class="absolute inset-0 bg-black/45 z-20 pointer-events-none rounded-3xl"
    />
  </component>
</template>
