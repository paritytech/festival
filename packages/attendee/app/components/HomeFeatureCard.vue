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
      <LockIcon v-if="!to" :size="18" :style="{ color: accent }" />
      <PlusIcon v-else :size="18" :style="{ color: accent }" />
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
