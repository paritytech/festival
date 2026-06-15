<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useSubEvents } from '~/composables/useSubEvents'
import { useSubEventManage } from '~/composables/useSubEventManage'
import { useSubEventCheckIn } from '~/composables/useSubEventCheckIn'
import { useSubEventRoles } from '~/composables/useSubEventRoles'
import { useFestival } from '~/composables/useFestival'
import { usePermissions } from '@festival/shared/permissions'
import {
  isValidEvmAddress,
  isSameAddress,
  shortenAddress,
  ss58ToH160,
} from '@festival/shared/utils/address'
import { resolveFullLocationLabel } from '@festival/shared/venue/floors'
import { formatTimeBerlin } from '@festival/shared/utils/time'

definePageMeta({
  validate: (route) => isValidEvmAddress(route.params.address as string),
})

const route = useRoute()
const addr = route.params.address as string

// ── Guard: session must exist in the festival's list ──
const { subEvents, isLoading: subEventsLoading } = useSubEvents()
const session = computed(() => subEvents.value.find((se) => se.address === addr))

watch(
  [subEvents, subEventsLoading],
  ([, loading]) => {
    if (loading) return
    if (!session.value) navigateTo('/', { replace: true })
  },
  { immediate: true },
)

// ── Guard: user must have canCheckIn permission ──
const { roles, isLoading: rolesLoading } = useSubEventRoles(addr)
const perms = usePermissions(roles)

watch(
  [roles, rolesLoading],
  ([, loading]) => {
    if (loading) return
    if (!perms.canCheckIn.value) {
      navigateTo(`/sessions/${addr}`, { replace: true })
    }
  },
  { immediate: true },
)

// ── Stats source + optimistic mutation target ──
const { attendees } = useSubEventManage(addr)

const checkedInCount = computed(
  () => attendees.value.filter((a) => a.isCheckedIn).length,
)

// ── Location line (no mock fallback) ──
const { metadata: festivalMetadata } = useFestival()
const venueMarkers = computed(() => festivalMetadata.value?.venueMap?.markers ?? [])
const venueZones = computed(() => festivalMetadata.value?.venueMap?.zones ?? [])
const locationLabel = computed(() => {
  const loc = session.value?.metadata.location
  if (!loc || !venueMarkers.value.length) return ''
  return resolveFullLocationLabel(loc, venueMarkers.value, venueZones.value)
})

const timeRange = computed(() => {
  if (!session.value) return ''
  const start = new Date(session.value.startTime * 1000)
  const end = new Date(session.value.endTime * 1000)
  return `${formatTimeBerlin(start)} – ${formatTimeBerlin(end)}`
})

// ── Check-in state machine ──
const {
  step,
  attendeeSS58,
  accountStatus,
  error: checkInError,
  recentCheckins,
  reset,
  startScanning,
  handleScan,
  executeCheckIn,
  manualCheckInByAddress,
} = useSubEventCheckIn(addr)

// Auto-start camera on mount
onMounted(() => {
  if (step.value === 'idle') startScanning()
})

// ── Optimistic attendees mutation + auto-reset after success ──
watch(step, (s) => {
  if (s !== 'success') return
  if (!attendeeSS58.value) return

  const wasRegistered = accountStatus.value?.registered ?? true
  try {
    const h160 = ss58ToH160(attendeeSS58.value)
    const existing = attendees.value.find((a) => isSameAddress(a.address, h160))
    if (existing) {
      existing.isCheckedIn = true
    } else if (!wasRegistered) {
      attendees.value.push({ address: h160, isCheckedIn: true })
    }
  } catch {
    // malformed address. Skip mutation, counts will fix up on next reload
  }

  setTimeout(() => {
    if (step.value === 'success') startScanning()
  }, 1500)
})

// ── Manual entry ──
const showManual = ref(false)
const manualInput = ref('')
const manualError = ref('')

async function submitManual() {
  manualError.value = ''
  const value = manualInput.value.trim()
  if (!value) return
  try {
    await manualCheckInByAddress(value)
    if (step.value === 'success') manualInput.value = ''
  } catch (e: any) {
    manualError.value = e?.message ?? 'Check-in failed'
  }
}

// ── Scanner pause: camera active only during scanning step ──
const scannerActive = computed(() => step.value === 'scanning')

const showCheckedInToast = ref(false)
watch(step, (s) => {
  if (s === 'success') showCheckedInToast.value = true
})

function onScannerError(msg: string) {
  checkInError.value = msg
  step.value = 'error'
}
</script>

<template>
  <div class="-mx-4 min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] flex flex-col">
    <!-- Header -->
    <div class="flex items-center px-4 pt-4 pb-3">
      <BackButton class="text-text-and-icons-primary" />
    </div>

    <!-- Title + time/location -->
    <div class="px-4 mb-4">
      <h1 class="text-2xl font-semibold text-white">{{ session?.metadata.name || 'Check-in' }}</h1>
      <p v-if="timeRange || locationLabel" class="text-sm text-text-muted mt-1">
        {{ timeRange }}
        <span v-if="timeRange && locationLabel"> · </span>
        {{ locationLabel }}
      </p>
    </div>

    <!-- Stats -->
    <div class="px-4 mb-4">
      <div class="rounded-2xl bg-surface-2 py-4 flex flex-col items-center">
        <span class="text-2xl font-semibold text-white leading-tight">{{ checkedInCount }}</span>
        <span class="text-xs text-text-muted mt-0.5">checked in</span>
      </div>
    </div>

    <!-- Camera (visible when scanning/idle; placeholder-sized otherwise) -->
    <div class="px-4 mb-4">
      <div class="relative w-full aspect-square rounded-2xl overflow-hidden border border-white/12 bg-black">
        <QRScanner
          :active="scannerActive"
          class="w-full h-full"
          @scan="handleScan"
          @error="onScannerError"
        />
        <div
          v-if="!scannerActive"
          class="absolute inset-0 flex items-center justify-center bg-surface-2/60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-white/40">
            <rect x="3" y="3" width="5" height="5" rx="1" />
            <rect x="16" y="3" width="5" height="5" rx="1" />
            <rect x="3" y="16" width="5" height="5" rx="1" />
            <path d="M16 16h2v2h-2zM19 19h2v2h-2zM13 3h2v2h-2zM13 8h2v2h-2zM13 13h2v2h-2zM8 13h2v2H8z" />
          </svg>
        </div>
      </div>
    </div>

    <!-- Step-dependent panel -->
    <div class="px-4 mb-4 min-h-[72px]">
      <p v-if="step === 'scanning'" class="text-sm text-text-muted text-center py-4">
        Point at an attendee's account QR.
      </p>

      <div
        v-else-if="step === 'validating'"
        class="rounded-2xl bg-surface-2 px-5 py-4 flex items-center gap-3"
      >
        <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
        <p class="text-sm text-white">Checking on-chain…</p>
      </div>

      <div
        v-else-if="step === 'confirming'"
        class="rounded-2xl bg-surface-2 px-5 py-4"
      >
        <p class="text-xs text-text-muted mb-1">Check in</p>
        <p class="text-sm font-mono text-white break-all">
          {{ attendeeSS58 ? shortenAddress(attendeeSS58) : '' }}
        </p>
        <div class="flex gap-2 mt-4">
          <button
            class="flex-1 py-3 rounded-2xl text-sm font-medium border border-white/12 text-white"
            @click="reset(); startScanning()"
          >
            Cancel
          </button>
          <button
            class="flex-1 py-3 rounded-2xl text-sm font-semibold bg-white text-black"
            @click="executeCheckIn"
          >
            Confirm
          </button>
        </div>
      </div>

      <div
        v-else-if="step === 'executing'"
        class="rounded-2xl bg-surface-2 px-5 py-4 flex items-center gap-3"
      >
        <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
        <p class="text-sm text-white">Checking in…</p>
      </div>

      <div
        v-else-if="step === 'success'"
        class="rounded-2xl bg-surface-2 px-5 py-4 flex items-center gap-3"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-green-400 shrink-0">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <p class="text-sm text-white">
          Checked in {{ attendeeSS58 ? shortenAddress(attendeeSS58) : '' }}
        </p>
      </div>

      <div
        v-else-if="step === 'error'"
        class="rounded-2xl bg-red-900/30 border border-red-500/20 px-5 py-4"
      >
        <p class="text-sm text-red-300">{{ checkInError || 'Something went wrong.' }}</p>
        <button
          class="mt-3 w-full py-3 rounded-2xl text-sm font-semibold bg-white text-black"
          @click="startScanning"
        >
          Try Again
        </button>
      </div>
    </div>

    <!-- Recent check-ins -->
    <div v-if="recentCheckins.length" class="px-4 mb-4">
      <p class="text-xs text-text-muted mb-2">Recent</p>
      <div class="rounded-2xl bg-surface-2 divide-y divide-white/8 overflow-hidden">
        <div
          v-for="(c, i) in recentCheckins"
          :key="i"
          class="flex justify-between px-4 py-2.5 text-sm"
        >
          <span class="font-mono text-white">{{ c.address }}</span>
          <span class="text-text-muted">{{ c.time }}</span>
        </div>
      </div>
    </div>

    <!-- Manual entry collapsible -->
    <div class="px-4 pb-8">
      <button
        class="flex items-center justify-between w-full text-sm text-text-muted py-2"
        @click="showManual = !showManual"
      >
        <span>Enter address manually</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="transition-transform"
          :class="{ 'rotate-180': showManual }"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div v-if="showManual" class="mt-2 space-y-2">
        <input
          v-model="manualInput"
          type="text"
          placeholder="5Grwva… or 0x…"
          class="w-full px-4 py-3 rounded-full border border-white/12 bg-transparent text-white placeholder-white/40 text-sm font-mono focus:outline-none focus:border-white/30"
          @keyup.enter="submitManual"
        />
        <button
          class="w-full py-3 rounded-2xl text-sm font-semibold bg-white text-black disabled:opacity-50"
          :disabled="!manualInput || step === 'validating' || step === 'executing'"
          @click="submitManual"
        >
          {{ step === 'executing' ? 'Checking In…' : 'Check In' }}
        </button>
        <p v-if="manualError" class="text-xs text-red-300">{{ manualError }}</p>
      </div>
    </div>
  </div>

  <div class="fixed bottom-28 left-4 right-4 md:left-[calc(var(--col-l)+1rem)] md:right-[calc(var(--col-r)+1rem)] z-[1000] pointer-events-none">
    <SuccessToast
      :visible="showCheckedInToast"
      variant="check"
      message="Checked In Successfully"
      @hide="showCheckedInToast = false"
    />
  </div>
</template>
