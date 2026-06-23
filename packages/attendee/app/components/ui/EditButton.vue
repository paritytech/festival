<script setup lang="ts">
import IconEdit from '~icons/ic/round-edit'

defineProps<{
  ariaLabel: string
}>()
</script>

<template>
  <button
    type="button"
    class="text-text-and-icons-primary"
    :aria-label="ariaLabel"
  >
    <IconEdit style="width: 20px; height: 20px" />
  </button>
</template>
