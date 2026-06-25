<script setup lang="ts">
// Decorative 12-point burst star used by BadgeEarnedScreen's celebration
// animation. Sized by the surrounding `.star` CSS (viewBox only, no width).
withDefaults(defineProps<{ fill?: string }>(), { fill: "#FFFFFF" });
</script>

<template>
  <svg viewBox="0 0 335 335" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M301.402 32.7049L242.743 147.83L334.107 239.194L206.489 218.982L147.83 334.107L127.617 206.489L-2.84458e-06 186.277L115.125 127.618L94.9127 0.000169247L186.277 91.3642L301.402 32.7049Z"
      :fill="fill"
    />
  </svg>
</template>
