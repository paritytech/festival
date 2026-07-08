<script setup lang="ts">
defineProps<{
  visible: boolean
  variant: 'error' | 'needed'
  title: string
  message: string
  primaryLabel: string
  secondaryLabel: string
  busy?: boolean
}>()

defineEmits<{
  primary: []
  secondary: []
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2200] bg-black/70 flex items-end justify-center"
        data-testid="activation-modal"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="w-full bg-surface-2 rounded-t-[32px] px-6 pt-8 pb-[calc(var(--safe-bottom)+24px)] flex flex-col items-center gap-6"
        >
          <!-- Icon + title + body -->
          <div class="flex flex-col items-center gap-3 text-center">
            <div
              class="w-14 h-14 rounded-full flex items-center justify-center"
              :class="variant === 'error' ? 'bg-danger' : 'bg-activations'"
            >
              <img
                :src="variant === 'error' ? '/error.svg' : '/confirmation_number.svg'"
                alt=""
                class="w-7 h-7"
              />
            </div>

            <h2 class="text-[24px] font-semibold leading-[32px] text-white">
              {{ title }}
            </h2>
            <p class="text-base leading-5 text-white/70">{{ message }}</p>
          </div>

          <!-- Buttons -->
          <div class="w-full flex flex-col gap-3">
            <button
              class="w-full py-[18px] rounded-2xl bg-white text-black text-base font-semibold disabled:opacity-50 flex items-center justify-center"
              data-testid="activation-modal-primary"
              :disabled="busy"
              @click="$emit('primary')"
            >
              <span v-if="!busy">{{ primaryLabel }}</span>
              <span
                v-else
                class="w-5 h-5 border-2 border-black/40 border-t-transparent rounded-full animate-spin"
                aria-label="Activating"
              />
            </button>
            <button
              class="w-full py-[18px] rounded-2xl bg-white/10 text-white text-base font-medium disabled:opacity-50"
              data-testid="activation-modal-secondary"
              :disabled="busy"
              @click="$emit('secondary')"
            >
              {{ secondaryLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
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
