<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import IconClose from '~icons/ic/round-close'
import { useWalletStore } from '@festival/shared/host/wallet'
import { isInHost } from '@festival/shared/host/detect'
import { checkAllowancesOnChain } from '@festival/shared/host/allowances'
import { ss58ToH160, shortenAddress } from '@festival/shared/utils/address'
import { generateQRDataUrl } from '@festival/shared/scanner/useQRImage'
import { useMyAddressModal } from '~/composables/useMyAddressModal'

const { isOpen, close } = useMyAddressModal()
const wallet = useWalletStore()

// Latest claim outcome, used to render a small status line.
// `null` = no claim attempted yet this modal session.
const claimStatus = ref<null | 'success' | 'partial' | 'error'>(null)

// PGAS balance as activation proxy (same signal the attendee SPA uses).
// `null` means unknown (pre-read, standalone, or RPC error) — keep the button
// enabled rather than lock the admin out on a transient failure.
const pgasGranted = ref<boolean | null>(null)

async function refreshGranted() {
  if (!isInHost() || !wallet.address) {
    pgasGranted.value = null
    return
  }
  try {
    const state = await checkAllowancesOnChain(wallet.address)
    pgasGranted.value = state.pgasGranted
  } catch (err) {
    console.warn('[MyAddressModal] allowance read failed:', err)
    pgasGranted.value = null
  }
}

async function onClaimAllowances() {
  if (wallet.isClaimingAllowances || pgasGranted.value === true) return
  // Pin to the account that tapped the button and bail on a mid-flow account
  // change rather than mark a different user as granted. Defensive against a
  // future multi-account path (host has one product account today).
  const claimAddr = wallet.address
  if (!claimAddr) return
  claimStatus.value = null
  try {
    const { outcomes } = await wallet.claimAllowances()
    if (wallet.address !== claimAddr) return
    if (!outcomes) {
      claimStatus.value = 'error'
      return
    }
    const allGranted = outcomes
      .filter((o) => o.key !== 'AutoSigning')
      .every((o) => o.tag === 'Allocated')
    claimStatus.value = allGranted ? 'success' : 'partial'
    // Trust the host outcome instead of re-reading: the chain read defaults to
    // finalized (~40s behind best), so it would still see balance=0 and leave
    // the button enabled. The next modal open re-reads as a fallback.
    if (allGranted) {
      pgasGranted.value = true
    }
  } catch (err) {
    console.error('[MyAddressModal] claim failed:', err)
    claimStatus.value = 'error'
  }
}

// Refresh chain state whenever the modal opens or the account switches while
// it's open. Clear stale claim status on close so reopening doesn't show old state.
watch([isOpen, () => wallet.address], ([open]) => {
  if (open) {
    void refreshGranted()
  } else {
    claimStatus.value = null
  }
})

const ss58 = computed(() => wallet.address || '')
const h160 = computed(() => (ss58.value ? ss58ToH160(ss58.value) : ''))

const qrDataUrl = ref<string | null>(null)
const copied = ref<'ss58' | 'h160' | null>(null)

async function generate() {
  if (!ss58.value) {
    qrDataUrl.value = null
    return
  }
  try {
    qrDataUrl.value = await generateQRDataUrl(ss58.value, { width: 320, margin: 1 })
  } catch (e) {
    console.warn('[MyAddressModal] QR generation failed', e)
    qrDataUrl.value = null
  }
}

watch([isOpen, ss58], ([open]) => {
  if (open) generate()
})

async function copy(which: 'ss58' | 'h160') {
  const text = which === 'ss58' ? ss58.value : h160.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which) copied.value = null
    }, 2000)
  } catch (e) {
    console.warn('[MyAddressModal] clipboard write failed', e)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        @click.self="close"
      >
        <div class="bg-surface rounded-3xl p-5 sm:p-6 max-w-sm w-full">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-heading text-lg font-bold">My address</h3>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/8 text-text-muted"
              @click="close"
            >
              <IconClose class="w-4 h-4" />
            </button>
          </div>

          <div class="aspect-square bg-white rounded-2xl flex items-center justify-center mb-4 p-3">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="Address QR" class="w-full h-full" />
            <div
              v-else
              class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            />
          </div>

          <div class="mb-3">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-text-muted">SS58</p>
              <button
                class="text-xs text-primary hover:text-primary-hover transition-colors"
                @click="copy('ss58')"
              >
                {{ copied === 'ss58' ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <p class="font-mono text-xs break-all bg-background rounded-lg p-2">{{ ss58 }}</p>
          </div>

          <div class="mb-3">
            <div class="flex items-center justify-between mb-1">
              <p class="text-xs text-text-muted">H160 (EVM)</p>
              <button
                class="text-xs text-primary hover:text-primary-hover transition-colors"
                @click="copy('h160')"
              >
                {{ copied === 'h160' ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <p class="font-mono text-xs break-all bg-background rounded-lg p-2">{{ h160 }}</p>
          </div>

          <p class="text-[11px] text-text-muted">
            Both formats represent the same on-chain account. The QR encodes the SS58.
          </p>

          <!-- Host-only: re-claim RFC-0010 allowances (Bulletin + PGAS).
               Per RFC-0010, each tap allocates an additional slot under the
               same account key — fine for topping up, but each press
               consumes a slot from the user's quota. -->
          <div v-if="isInHost()" class="mt-4 pt-4 border-t border-border">
            <button
              type="button"
              :disabled="wallet.isClaimingAllowances || !wallet.isConnected || pgasGranted === true"
              class="w-full bg-primary hover:bg-primary-hover disabled:opacity-60 disabled:cursor-not-allowed text-black text-sm font-medium rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2"
              @click="onClaimAllowances"
            >
              <span
                v-if="wallet.isClaimingAllowances"
                class="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"
              />
              <span>
                {{
                  wallet.isClaimingAllowances
                    ? 'Claiming…'
                    : pgasGranted === true
                      ? 'Allowances claimed'
                      : 'Claim allowances'
                }}
              </span>
            </button>
            <p
              v-if="claimStatus === 'success'"
              class="text-[11px] text-success mt-2"
            >
              Allowances claimed.
            </p>
            <p
              v-else-if="claimStatus === 'partial'"
              class="text-[11px] text-warning mt-2"
            >
              Partial allocation — please tap Claim allowances again.
            </p>
            <p
              v-else-if="claimStatus === 'error'"
              class="text-[11px] text-danger mt-2"
            >
              Claim failed. See console for details.
            </p>
          </div>

          <div v-if="wallet.accounts.length > 1" class="mt-4 pt-4 border-t border-border">
            <p class="text-xs text-text-muted mb-2">Switch account</p>
            <div class="bg-surface-2 rounded-lg overflow-hidden">
              <button
                v-for="acc in wallet.accounts"
                :key="acc.address"
                class="w-full text-left px-3 py-2 text-xs hover:bg-white/8 transition-colors border-b border-border last:border-b-0"
                :class="acc.address === wallet.address ? 'font-medium text-text-primary' : 'text-text-secondary'"
                @click="wallet.selectAccount(acc)"
              >
                <p class="truncate">{{ acc.name || 'Account' }}</p>
                <p class="font-mono text-text-muted truncate">{{ shortenAddress(acc.address) }}</p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
