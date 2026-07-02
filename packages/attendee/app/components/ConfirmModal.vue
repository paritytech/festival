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
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-black/80 z-[60] flex items-end"
      @click.self="$emit('cancel')"
    >
      <div class="w-full bg-bg-surface-container rounded-t-3xl p-6 pb-[calc(var(--safe-bottom)+24px)]">
        <h2 class="text-xl font-semibold text-text-and-icons-primary">{{ title }}</h2>
        <p class="text-sm text-text-and-icons-tertiary mt-2">{{ message }}</p>
        <Button
          :variant="confirmVariant"
          block
          class="mt-6"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
        <Button
          variant="ghost"
          block
          class="mt-3"
          @click="$emit('cancel')"
        >
          Cancel
        </Button>
      </div>
    </div>
  </Transition>
</template>
