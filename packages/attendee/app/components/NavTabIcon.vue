<script setup lang="ts">
import { computed, type Component } from "vue";
import IconHome from "~icons/ic/round-home";
import IconMap from "~icons/ic/round-map";
import IconProgram from "~icons/ic/round-event-note";

const props = withDefaults(
  defineProps<{ icon: string; size?: number | string }>(),
  { size: 22 },
);

const ICONS: Record<string, Component> = {
  home: IconHome,
  map: IconMap,
  program: IconProgram,
};

const current = computed(() => ICONS[props.icon]);
// The icons render at 1em, so font-size drives their box; color inherits via currentColor.
const fontSize = computed(() =>
  typeof props.size === "number" ? `${props.size}px` : props.size,
);
</script>

<template>
  <component :is="current" :style="{ fontSize }" />
</template>
