<script setup lang="ts">
import { useAttrs } from 'vue'
import IconChevronLeft from '~icons/ic/round-chevron-left'

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
    <IconChevronLeft style="width: 24px; height: 24px" aria-hidden="true" />
  </button>
</template>
