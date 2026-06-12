<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string }>(), { size: 18 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path
      d="M3 17.46v3.04c0 .28.22.5.5.5h3.04c.13 0 .26-.05.35-.15L17.81 9.94l-3.75-3.75L3.15 17.1a.49.49 0 0 0-.15.36Z"
      fill="currentColor"
    />
    <path
      d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83a1 1 0 0 0 0-1.41Z"
      fill="currentColor"
    />
  </svg>
</template>
