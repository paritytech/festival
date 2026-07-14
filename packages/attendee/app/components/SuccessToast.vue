<script setup lang="ts">
import { watch, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  visible: boolean
  message?: string
  variant?: 'star' | 'check'
}>(), {
  variant: 'star',
})

const emit = defineEmits<{
  hide: []
}>()

let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.visible, (v) => {
  if (timer) clearTimeout(timer)
  if (v) {
    timer = setTimeout(() => emit('hide'), 2500)
  }
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <Transition name="success-toast">
    <div
      v-if="visible"
      class="flex items-center gap-3 rounded-2xl bg-bg-surface-nested px-5 py-4"
    >
      <!-- Star icon -->
      <svg
        v-if="props.variant === 'star'"
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1.5"
        class="shrink-0 text-text-and-icons-primary"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      <!-- Check icon -->
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="shrink-0 text-text-and-icons-primary"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span class="text-sm font-medium text-text-and-icons-primary">{{ message || 'Added to My List Successfully' }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.success-toast-enter-active,
.success-toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.success-toast-enter-from,
.success-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
