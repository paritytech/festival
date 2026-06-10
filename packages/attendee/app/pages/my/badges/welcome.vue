<script setup lang="ts">
const steps = [
  { illustration: '/onb-badge-3.svg', title: 'Find & attend a community session' },
  { illustration: '/onb-badge-4.svg', title: 'Show your QR to collect the badge' },
  { illustration: '/onb-badge-5.svg', title: 'Build your unique badge collection' },
]
</script>

<template>
  <OnboardingFlow :steps="steps" storage-key="receive-badge" />
</template>
