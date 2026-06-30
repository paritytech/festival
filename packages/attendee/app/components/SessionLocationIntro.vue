<script setup lang="ts">
// Body-only. The "Choose Location" CTA is rendered by the parent page so
// step-2's bottom action area keeps its consistent slot for the primary button.
</script>

<template>
  <div class="sli">
    <img class="sli__hero" src="/pick-spot.svg" alt="" aria-hidden="true" />
    <h2 class="sli__title">The venue is yours drop a pin anywhere!</h2>
  </div>
</template>

<style scoped>
.sli {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 24px 24px;
  gap: 24px;
}
.sli__hero {
  width: 220px;
  max-width: 70%;
  height: auto;
  display: block;
}
.sli__title {
  color: var(--color-text-and-icons-primary);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
  max-width: 320px;
}
</style>
