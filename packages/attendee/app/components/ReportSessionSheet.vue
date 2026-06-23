<script setup lang="ts">
import { computed } from 'vue'
import IconFlag from '~icons/ic/round-flag'
import IconCheck from '~icons/ic/round-check'
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
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-black/70 z-[1000] flex items-end justify-center"
      data-testid="report-session-sheet"
      @click.self="!isPending && (isSuccess ? $emit('done') : $emit('cancel'))"
    >
      <div
        class="w-full bg-surface-2 rounded-t-[32px] px-6 pt-4 pb-[calc(var(--safe-bottom)+24px)] flex flex-col items-center gap-6"
      >
        <!-- Icon + Title + Body -->
        <div class="flex flex-col items-center gap-1 w-full">
          <!-- Icon circle -->
          <div
            v-if="!isSuccess"
            class="w-14 h-14 rounded-full bg-danger flex items-center justify-center"
          >
            <IconFlag style="width: 22px; height: 22px; color: white" />
          </div>
          <div
            v-else
            class="w-14 h-14 rounded-full bg-success flex items-center justify-center"
          >
            <IconCheck style="width: 24px; height: 24px; color: white" />
          </div>

          <div class="flex flex-col gap-1 items-center text-center w-full p-2">
            <h2 class="text-[24px] font-semibold leading-[32px] text-white">
              {{ isSuccess ? 'Report sent' : 'Report this session' }}
            </h2>
            <p class="text-base leading-5 text-white/70">
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
          class="w-full flex items-center justify-center gap-3 rounded-2xl bg-white/[0.02] py-3"
        >
          <div class="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
          <p class="text-sm text-white/70">Reporting…</p>
        </div>

        <div
          v-if="error && !isPending && !isSuccess"
          class="w-full rounded-2xl bg-danger/10 px-4 py-3"
        >
          <p class="text-sm text-danger leading-snug text-center">{{ error }}</p>
        </div>

        <!-- Buttons -->
        <div v-if="isSuccess" class="w-full">
          <button
            class="w-full py-[18px] rounded-2xl bg-white text-black text-base font-medium"
            data-testid="report-session-done"
            @click="$emit('done')"
          >
            Done
          </button>
        </div>
        <div v-else class="w-full flex flex-col gap-2">
          <button
            class="w-full py-[18px] rounded-2xl bg-danger text-white text-base font-medium disabled:opacity-50"
            data-testid="report-session-confirm"
            :disabled="isPending"
            @click="$emit('confirm')"
          >
            Report &amp; Hide Session
          </button>
          <button
            class="w-full py-3 text-white/70 text-base font-medium disabled:opacity-50"
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
