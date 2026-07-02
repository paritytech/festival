<script setup lang="ts">
import { computed } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'

const props = defineProps<{
  visible: boolean
  txStatus: TxStatus
  error: string | null
}>()

defineEmits<{
  confirm: []
  cancel: []
  done: []
}>()

const isSuccess = computed(
  () => props.txStatus === 'in-block' || props.txStatus === 'finalized',
)
const isPending = computed(
  () => props.txStatus !== 'idle' && props.txStatus !== 'error' && !isSuccess.value,
)
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-bg-surface-overlay z-[1000] flex items-end justify-center"
      data-testid="report-session-sheet"
      @click.self="!isPending && (isSuccess ? $emit('done') : $emit('cancel'))"
    >
      <div
        class="w-full bg-bg-surface-nested rounded-t-[32px] px-6 pt-4 pb-[calc(var(--safe-bottom)+24px)] flex flex-col items-center gap-6"
      >
        <!-- Icon + Title + Body -->
        <div class="flex flex-col items-center gap-1 w-full">
          <!-- Icon circle -->
          <div
            v-if="!isSuccess"
            class="w-14 h-14 rounded-full bg-bg-status-error flex items-center justify-center"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 21V5h11l-1.5 4L16 13H5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div
            v-else
            class="w-14 h-14 rounded-full bg-bg-status-success flex items-center justify-center"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 12.5L10 17.5L19 7.5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <div class="flex flex-col gap-1 items-center text-center w-full p-2">
            <h2 class="text-[24px] font-semibold leading-[32px] text-text-and-icons-primary">
              {{ isSuccess ? 'Report sent' : 'Report this session' }}
            </h2>
            <p class="text-base leading-5 text-text-and-icons-secondary">
              {{
                isSuccess
                  ? "Thanks for letting us know. This session is now hidden from your Program and My List. We'll review it shortly."
                  : "Your report is anonymous. Once submitted, this session will be removed from your Program and My List."
              }}
            </p>
          </div>
        </div>

        <!-- Pending status / error -->
        <div
          v-if="isPending"
          class="w-full flex items-center justify-center gap-3 rounded-2xl bg-fill-6 py-3"
        >
          <Spinner size="sm" class="text-text-and-icons-primary/60" />
          <p class="text-sm text-text-and-icons-secondary">Reporting…</p>
        </div>

        <div
          v-if="error && !isPending && !isSuccess"
          class="w-full rounded-2xl bg-bg-status-error/10 px-4 py-3"
        >
          <p class="text-sm text-fg-error leading-snug text-center">{{ error }}</p>
        </div>

        <!-- Buttons -->
        <div v-if="isSuccess" class="w-full">
          <button
            class="w-full py-[18px] rounded-2xl bg-bg-action-primary text-fg-primary-inverted text-base font-medium"
            data-testid="report-session-done"
            @click="$emit('done')"
          >
            Done
          </button>
        </div>
        <div v-else class="w-full flex flex-col gap-2">
          <button
            class="w-full py-[18px] rounded-2xl bg-bg-status-error text-text-and-icons-primary text-base font-medium disabled:opacity-50"
            data-testid="report-session-confirm"
            :disabled="isPending"
            @click="$emit('confirm')"
          >
            Report &amp; Hide Session
          </button>
          <button
            class="w-full py-3 text-text-and-icons-secondary text-base font-medium disabled:opacity-50"
            data-testid="report-session-cancel"
            :disabled="isPending"
            @click="$emit('cancel')"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
