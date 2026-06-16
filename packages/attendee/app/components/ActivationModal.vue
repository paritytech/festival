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
        class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2200] bg-black/70 flex items-center justify-center px-6"
        data-testid="activation-modal"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="w-full max-w-sm bg-surface-2 rounded-[28px] px-6 py-7 flex flex-col items-center gap-6"
        >
          <!-- Icon + title + body -->
          <div class="flex flex-col items-center gap-3 text-center">
            <div
              v-if="variant === 'error'"
              class="w-16 h-16 rounded-full bg-danger flex items-center justify-center"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 6v8" stroke="white" stroke-width="2.5" stroke-linecap="round" />
                <circle cx="12" cy="17.5" r="1.4" fill="white" />
              </svg>
            </div>
            <div
              v-else
              class="w-16 h-16 rounded-full bg-activations flex items-center justify-center"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M4 7a1 1 0 0 0-1 1v2.2a1.8 1.8 0 0 1 0 3.6V16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2.2a1.8 1.8 0 0 1 0-3.6V8a1 1 0 0 0-1-1H4Z"
                  fill="black"
                />
                <circle cx="10.2" cy="12" r="0.9" fill="#FFB300" />
                <circle cx="13.8" cy="12" r="0.9" fill="#FFB300" />
              </svg>
            </div>

            <h2 class="text-[26px] font-semibold leading-[32px] text-white">
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
