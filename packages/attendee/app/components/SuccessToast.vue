<script setup lang="ts">
import { watch, onUnmounted } from 'vue'
import IconStar from '~icons/ic/round-star'
import IconCheck from '~icons/ic/round-check'

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
      class="flex items-center gap-3 rounded-2xl bg-surface-2 px-5 py-4"
    >
      <!-- Star icon -->
      <IconStar
        v-if="props.variant === 'star'"
        style="width: 20px; height: 20px"
        class="shrink-0 text-white"
      />
      <!-- Check icon -->
      <IconCheck
        v-else
        style="width: 20px; height: 20px"
        class="shrink-0 text-white"
      />
      <span class="text-sm font-medium text-white">{{ message || 'Added to My List Successfully' }}</span>
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
