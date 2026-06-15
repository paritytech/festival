<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useFestival } from '~/composables/useFestival'
import { useRegistration } from '~/composables/useRegistration'
import { createCheckInChallenge } from '@festival/shared/checkin/sign'
import { encodeCheckInQR } from '@festival/shared/checkin/qr'
import { generateQRDataUrl } from '@festival/shared/scanner/useQRImage'
import { useWalletStore } from '@festival/shared/host/wallet'

const { festivalAddress, metadata } = useFestival()
const { isRegistered, ticketTokenId, isCheckedIn } = useRegistration(festivalAddress)
const wallet = useWalletStore()

const REFRESH_INTERVAL = 5 * 60
const timeRemaining = ref(REFRESH_INTERVAL)
const qrDataUrl = ref<string | null>(null)
const qrError = ref<string | null>(null)
const isGenerating = ref(false)

async function revealTicket() {
  if (!ticketTokenId.value || isGenerating.value) return

  isGenerating.value = true
  qrError.value = null

  try {
    const { payload, signature } = await createCheckInChallenge(
      festivalAddress,
      ticketTokenId.value,
      wallet.address,
      wallet.signRaw,
    )
    const qrString = encodeCheckInQR(payload, signature)

    qrDataUrl.value = await generateQRDataUrl(qrString)
    timeRemaining.value = REFRESH_INTERVAL
  } catch (e: any) {
    qrError.value = e?.message || 'Failed to generate QR code'
    qrDataUrl.value = null
  } finally {
    isGenerating.value = false
  }
}

// Timer only counts down while QR is visible; resets to "reveal" state when expired
const timer = setInterval(() => {
  if (!qrDataUrl.value) return
  timeRemaining.value--
  if (timeRemaining.value <= 0) {
    qrDataUrl.value = null
    timeRemaining.value = REFRESH_INTERVAL
  }
}, 1000)

onUnmounted(() => clearInterval(timer))

const minutes = computed(() => Math.floor(timeRemaining.value / 60))
const seconds = computed(() => (timeRemaining.value % 60).toString().padStart(2, '0'))
</script>

<template>
  <div class="max-w-md mx-auto">
    <NuxtLink to="/" class="text-xs text-text-muted hover:text-text-secondary mb-4 block">
      ← Back to Hub
    </NuxtLink>

    <!-- Not registered -->
    <div v-if="!isRegistered" class="text-center py-12">
      <p class="text-text-muted mb-2">You're not registered yet.</p>
      <NuxtLink to="/" class="text-primary text-sm">Register first</NuxtLink>
    </div>

    <!-- Registered (checked in or not) -->
    <div v-else>
      <div class="text-center mb-4">
        <h2 class="font-heading text-xl font-bold">{{ metadata?.name }}</h2>
        <p class="text-text-secondary text-sm">Your Ticket</p>
      </div>

      <!-- Check-in status banner -->
      <div
        class="rounded-md p-3 mb-4 text-center text-sm font-medium"
        :class="isCheckedIn
          ? 'bg-green-50 border border-green-200 text-green-800'
          : 'bg-yellow-50 border border-yellow-200 text-yellow-800'"
      >
        <span v-if="isCheckedIn">You're checked in</span>
        <span v-else>Awaiting check-in — show this QR to staff</span>
      </div>

      <!-- QR Code area -->
      <div
        class="bg-surface-elevated border border-border rounded-lg p-6 mb-4"
        :class="isCheckedIn && 'opacity-50'"
      >
        <!-- Reveal button (no QR yet) -->
        <div v-if="!qrDataUrl && !isGenerating && !qrError" class="aspect-square flex flex-col items-center justify-center text-center">
          <p class="text-sm text-text-muted mb-4">Tap to sign and reveal your check-in QR</p>
          <button
            class="px-6 py-3 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-hover transition-colors"
            @click="revealTicket"
          >
            Reveal Ticket
          </button>
        </div>

        <!-- Signing in progress -->
        <div v-else-if="isGenerating" class="aspect-square flex flex-col items-center justify-center">
          <div class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <p class="text-sm text-text-muted">Waiting for signature...</p>
        </div>

        <!-- Error -->
        <div v-else-if="qrError" class="aspect-square flex flex-col items-center justify-center text-center px-4">
          <p class="text-sm text-red-600 mb-2">{{ qrError }}</p>
          <button
            class="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-hover transition-colors"
            @click="revealTicket"
          >
            Retry
          </button>
        </div>

        <!-- QR Image -->
        <div v-else-if="qrDataUrl" class="aspect-square bg-white rounded-md flex items-center justify-center border border-border-light p-4">
          <img :src="qrDataUrl" alt="Check-in QR code" class="w-full h-full" />
        </div>

        <p class="text-center text-xs text-text-muted font-mono mt-3">Ticket #{{ ticketTokenId }}</p>

        <!-- Timer (only when QR is visible and not checked in) -->
        <div v-if="qrDataUrl && !isCheckedIn" class="text-center mt-4">
          <p class="text-xs text-text-muted">Expires in</p>
          <p class="text-2xl font-mono font-bold text-primary">{{ minutes }}:{{ seconds }}</p>
        </div>
      </div>

      <!-- Instructions -->
      <div class="bg-surface border border-border rounded-md p-4 text-center">
        <p v-if="!isCheckedIn" class="text-sm text-text-secondary">
          Show this QR code to check-in staff. Each code is valid for 5 minutes and requires a new signature.
        </p>
        <p v-else class="text-sm text-text-secondary">
          You've been checked in. Your festival POAP has been minted to your wallet.
        </p>
      </div>
    </div>
  </div>
</template>
