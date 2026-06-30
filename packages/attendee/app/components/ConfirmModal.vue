<script setup lang="ts">
withDefaults(defineProps<{
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  confirmVariant?: 'danger' | 'primary'
}>(), { confirmVariant: 'danger' })

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-bg-surface-overlay z-[60] flex items-end"
      @click.self="$emit('cancel')"
    >
      <div class="w-full bg-bg-surface-container rounded-t-3xl p-6 pb-[calc(var(--safe-bottom)+24px)]">
        <h2 class="text-xl font-semibold text-text-and-icons-primary">{{ title }}</h2>
        <p class="text-sm text-text-and-icons-tertiary mt-2">{{ message }}</p>
        <button
          class="w-full py-4 rounded-2xl text-sm font-semibold mt-6"
          :class="confirmVariant === 'danger' ? 'bg-bg-status-error text-text-and-icons-primary' : 'bg-bg-action-primary text-fg-primary-inverted'"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
        <button
          class="w-full py-4 text-text-and-icons-primary text-sm font-medium mt-3"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
