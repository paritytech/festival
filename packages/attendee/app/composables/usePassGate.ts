/**
 * Gates an allowance-requiring action behind the festival pass. If the pass is
 * active the action runs immediately; otherwise it prompts via ActivationModal,
 * claims on confirm, and runs the stashed action on success — one tap, no
 * re-click. Drives the modal through `modalProps` + `state`.
 */

import { computed, ref } from 'vue'
import { useFestivalPass } from './useFestivalPass'

type GateState = 'none' | 'needed' | 'failed'

const FAILED_MESSAGE =
  "Something went wrong activating your pass. Try again, or do it later — some features will ask you to activate when you use them."

export function usePassGate(actionLabel: string) {
  const { isPassActive, ensureAllowance, defer } = useFestivalPass()
  const state = ref<GateState>('none')
  const busy = ref(false)
  let pending: (() => void | Promise<void>) | null = null

  function run(action: () => void | Promise<void>): void {
    if (isPassActive.value) {
      void action()
      return
    }
    pending = action
    state.value = 'needed'
  }

  async function onPrimary(): Promise<void> {
    busy.value = true
    const ok = await ensureAllowance()
    busy.value = false
    if (!ok) {
      state.value = 'failed'
      return
    }
    state.value = 'none'
    const action = pending
    pending = null
    if (action) await action()
  }

  function onSecondary(): void {
    if (state.value === 'failed') defer()
    state.value = 'none'
    pending = null
  }

  const modalProps = computed(() =>
    state.value === 'failed'
      ? {
          variant: 'error' as const,
          title: 'Activation failed',
          message: FAILED_MESSAGE,
          primaryLabel: 'Try again',
          secondaryLabel: 'Do it later',
          busy: busy.value,
        }
      : {
          variant: 'needed' as const,
          title: 'Activation needed',
          message: `To ${actionLabel}, you'll need to activate your pass first.`,
          primaryLabel: 'Activate Festival Pass',
          secondaryLabel: 'Not now',
          busy: busy.value,
        },
  )

  return { state, busy, run, onPrimary, onSecondary, modalProps }
}
