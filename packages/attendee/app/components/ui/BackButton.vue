<script setup lang="ts">
import { useAttrs } from 'vue'

const router = useRouter()
const attrs = useAttrs()

function handleClick() {
  if (!attrs.onClick) router.back()
}
</script>

<template>
  <button
    class="w-10 h-10 flex items-center justify-center -ml-2"
    aria-label="Back"
    @click="handleClick"
  >
    <BackIcon />
  </button>
</template>
