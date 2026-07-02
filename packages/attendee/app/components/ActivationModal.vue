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
        class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2200] bg-bg-surface-overlay flex items-end justify-center"
        data-testid="activation-modal"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="w-full bg-bg-surface-nested rounded-t-[32px] px-6 pt-8 pb-[calc(var(--safe-bottom)+24px)] flex flex-col items-center gap-6"
        >
          <!-- Icon + title + body -->
          <div class="flex flex-col items-center gap-3 text-center">
            <div
              class="w-14 h-14 rounded-full flex items-center justify-center"
              :class="variant === 'error' ? 'bg-bg-status-error' : 'bg-activations'"
            >
              <img
                :src="variant === 'error' ? '/error.svg' : '/confirmation_number.svg'"
                alt=""
                class="w-7 h-7"
              />
            </div>

            <h2 class="text-[24px] font-semibold leading-[32px] text-text-and-icons-primary">
              {{ title }}
            </h2>
            <p class="text-base leading-5 text-text-and-icons-secondary">{{ message }}</p>
          </div>

          <!-- Buttons -->
          <div class="w-full flex flex-col gap-3">
            <Button
              variant="primary"
              size="lg"
              block
              data-testid="activation-modal-primary"
              :disabled="busy"
              @click="$emit('primary')"
            >
              <span v-if="!busy">{{ primaryLabel }}</span>
              <Spinner
                v-else
                size="md"
                class="text-fg-primary-inverted/40"
                label="Activating"
              />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              data-testid="activation-modal-secondary"
              :disabled="busy"
              @click="$emit('secondary')"
            >
              {{ secondaryLabel }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
