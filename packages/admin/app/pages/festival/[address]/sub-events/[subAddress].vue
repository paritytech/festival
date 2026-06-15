<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSubEvents } from '~/composables/useSubEvents'
import { usePermissions, type FestivalRole } from '~/composables/usePermissions'
import { loadUserRoles } from '@festival/shared/contracts/role-helpers'
import { readSessionAttendees, readIsCheckedIn } from '@festival/shared/contracts/festival-reads'
import { writeContract } from '@festival/shared/contracts/write'
import type { TxStatus } from '@festival/shared/contracts/write'
import { FestivalSessionABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import {
  h160ToSs58,
  ss58ToH160,
  isValidEvmAddress,
  isValidSs58,
  shortenAddress,
} from '@festival/shared/utils/address'

definePageMeta({ layout: 'festival' })

const route = useRoute()
const address = route.params.address as string
const subAddress = route.params.subAddress as string

// Session metadata from the already-loaded sub-events list
const { subEvents, cancelSession, txStatus: cancelTxStatus } = useSubEvents(address)
const session = computed(() => subEvents.value.find(se => se.address.toLowerCase() === subAddress.toLowerCase()))
const metadata = computed(() => session.value?.metadata)
const cancelError = ref<string | null>(null)

// Festival-level roles drive the moderation cancel permission (separate from session roles).
const festivalRoles = ref<FestivalRole[]>([])
async function loadFestivalRoles() {
  try {
    festivalRoles.value = await loadUserRoles(address as `0x${string}`)
  } catch (e) {
    console.error('[SessionDetail] Failed to load festival roles:', e)
  }
}
loadFestivalRoles()
const canModerateCancel = computed(
  () => festivalRoles.value.includes('ADMIN') || festivalRoles.value.includes('MANAGER'),
)
const reportThresholdReached = computed(
  () => session.value !== undefined
    && !session.value.cancelled
    && session.value.flagCount >= session.value.flagThreshold,
)

async function handleModerationCancel() {
  cancelError.value = null
  try {
    await cancelSession(subAddress)
  } catch (e: any) {
    cancelError.value = e?.message ?? formatTxError(e)
  }
}

// ── Session check-in with proactive festival-POAP gate ──

type LookupState = 'idle' | 'invalid-address' | 'not-festival-checked-in' | 'ready'

const checkInInput = ref('')
const lookupState = ref<LookupState>('idle')
const isLookingUp = ref(false)
const resolvedAttendeeH160 = ref<`0x${string}` | null>(null)
const resolvedAttendeeSs58 = ref<string>('')
const checkInTxStatus = ref<TxStatus>('idle')
const checkInError = ref<string | null>(null)

const checkInBusy = computed(
  () =>
    checkInTxStatus.value !== 'idle'
    && checkInTxStatus.value !== 'error'
    && checkInTxStatus.value !== 'finalized',
)

function resetLookup() {
  lookupState.value = 'idle'
  resolvedAttendeeH160.value = null
  resolvedAttendeeSs58.value = ''
  checkInError.value = null
  if (checkInTxStatus.value === 'error' || checkInTxStatus.value === 'finalized') {
    checkInTxStatus.value = 'idle'
  }
}

async function lookupAttendee() {
  resetLookup()
  isLookingUp.value = true
  try {
    const input = checkInInput.value.trim()
    let h160: `0x${string}`
    if (isValidEvmAddress(input)) {
      h160 = input as `0x${string}`
    } else if (isValidSs58(input)) {
      h160 = ss58ToH160(input)
    } else {
      lookupState.value = 'invalid-address'
      return
    }
    resolvedAttendeeH160.value = h160
    resolvedAttendeeSs58.value = h160ToSs58(h160)

    const checkedIn = await readIsCheckedIn(address as `0x${string}`, h160)
    lookupState.value = checkedIn ? 'ready' : 'not-festival-checked-in'
  } catch (e: any) {
    checkInError.value = formatTxError(e)
  } finally {
    isLookingUp.value = false
  }
}

async function performSessionCheckIn() {
  if (lookupState.value !== 'ready' || !resolvedAttendeeH160.value) return
  checkInError.value = null
  checkInTxStatus.value = 'preparing'

  try {
    const wallet = useWalletStore()
    await writeContract({
      address: subAddress as `0x${string}`,
      abi: FestivalSessionABI,
      functionName: 'manualCheckIn',
      args: [resolvedAttendeeH160.value],
      signer: wallet.getSigner(),
      walletAddress: wallet.address,
      onStatus: (s) => { checkInTxStatus.value = s },
    })

    await loadAttendees()
    checkInInput.value = ''
    resetLookup()
  } catch (e: any) {
    checkInTxStatus.value = 'error'
    checkInError.value = formatTxError(e)
  }
}

// Attendees
const attendees = ref<{ address: `0x${string}`; isCheckedIn: boolean }[]>([])
const attendeesLoading = ref(true)

async function loadAttendees() {
  attendeesLoading.value = true
  try {
    attendees.value = await readSessionAttendees(subAddress as `0x${string}`)
  } catch (e) {
    console.error('[SessionDetail] Failed to load attendees:', e)
  } finally {
    attendeesLoading.value = false
  }
}
loadAttendees()

// Sub-event has its OWN independent roles. Not inherited from the parent festival
const subEventRoles = ref<FestivalRole[]>([])
const rolesLoading = ref(true)

async function loadRoles() {
  rolesLoading.value = true
  try {
    subEventRoles.value = await loadUserRoles(subAddress as `0x${string}`)
  } catch (e) {
    console.error('[SessionDetail] Failed to load roles:', e)
  } finally {
    rolesLoading.value = false
  }
}
loadRoles()

const perms = usePermissions(subEventRoles)
const hasAnyRole = computed(() => subEventRoles.value.length > 0)
const topSessionRoleLabel = computed<string | null>(() => {
  if (perms.isAdmin.value) return 'ADMIN'
  if (perms.isManager.value) return 'MANAGER'
  if (perms.isVolunteer.value) return 'VOLUNTEER'
  return null
})
const checkedInCount = computed(() => attendees.value.filter(a => a.isCheckedIn).length)

// Only show tabs the user has access to
const visibleTabs = computed(() => {
  const tabs: { key: string; label: string }[] = [
    { key: 'overview', label: 'Overview' },
  ]
  if (perms.canCheckIn.value) tabs.push({ key: 'checkin', label: 'Check-In' })
  if (hasAnyRole.value) tabs.push({ key: 'attendees', label: 'Attendees' })
  if (perms.isAdmin.value) tabs.push({ key: 'settings', label: 'Settings' })
  return tabs
})

const activeTab = ref('overview')

function shortenAddr(addr: string) {
  return addr.slice(0, 8) + '…' + addr.slice(-4)
}

function displayAccount(h160: string) {
  return shortenAddress(h160ToSs58(h160), 8, 6)
}
</script>

<template>
  <div>
    <div v-if="metadata" class="flex items-start gap-4 mb-4">
      <div
        v-if="metadata.badgePixels"
        class="w-16 h-16 rounded border border-border shrink-0 overflow-hidden"
      >
        <BadgeCanvas :pixels="metadata.badgePixels" :size="64" />
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="font-heading text-2xl font-bold">{{ metadata.name }}</h2>
        <p class="text-text-secondary text-sm">{{ metadata.description }}</p>
        <div class="flex flex-wrap items-center gap-2 mt-1">
          <p class="text-xs text-text-muted font-mono">{{ shortenAddr(subAddress) }}</p>
          <template v-if="!rolesLoading">
            <span
              v-if="topSessionRoleLabel"
              class="hidden sm:inline-block text-[10px] px-1.5 py-0.5 bg-white/10 text-text-secondary rounded font-medium"
            >
              {{ topSessionRoleLabel }}
            </span>
            <span v-else class="text-[10px] px-1.5 py-0.5 bg-surface-2 text-text-muted rounded">
              View only
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 overflow-x-auto sm:bg-surface sm:rounded-xl sm:p-1 sm:w-fit">
      <button
        v-for="tab in visibleTabs"
        :key="tab.key"
        class="px-4 py-2 text-sm rounded transition-colors shrink-0 whitespace-nowrap"
        :class="activeTab === tab.key ? 'bg-white/10 font-medium' : 'text-text-muted'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Overview Tab (visible to all) -->
    <div v-if="activeTab === 'overview'" class="space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-surface rounded-xl p-4">
          <p class="text-2xl font-bold">{{ session?.registeredCount ?? '—' }}</p>
          <p class="text-xs text-text-muted">Registered</p>
        </div>
        <div class="bg-surface rounded-xl p-4">
          <p class="text-2xl font-bold">{{ attendeesLoading ? '—' : checkedInCount }}</p>
          <p class="text-xs text-text-muted">Checked In</p>
        </div>
      </div>

      <div
        v-if="session && !session.cancelled && session.flagCount > 0"
        class="rounded-xl p-4 space-y-3"
        :class="reportThresholdReached ? 'bg-danger-muted' : 'bg-warning-muted'"
        data-testid="moderation-banner"
      >
        <div class="flex items-center gap-3">
          <span
            class="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
            :class="reportThresholdReached ? 'bg-danger/20 text-danger' : 'bg-warning/20 text-warning'"
          >⚑</span>
          <div class="min-w-0 flex-1">
            <p
              class="text-sm font-medium"
              :class="reportThresholdReached ? 'text-danger' : 'text-warning'"
            >
              {{ session.flagCount }} of {{ session.flagThreshold }} reports
            </p>
            <p class="text-xs text-text-muted leading-snug mt-0.5">
              {{
                reportThresholdReached
                  ? 'This session reached the report threshold and can be cancelled by a festival admin or manager. The creator does not get their day-slot back.'
                  : 'Reports submitted by festival POAP holders.'
              }}
            </p>
          </div>
        </div>

        <button
          v-if="reportThresholdReached && canModerateCancel"
          class="w-full px-4 py-2.5 bg-danger text-white rounded-2xl text-sm font-medium hover:bg-danger/80 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="moderation-cancel-button"
          :disabled="cancelTxStatus !== 'idle' && cancelTxStatus !== 'error' && cancelTxStatus !== 'finalized'"
          @click="handleModerationCancel"
        >
          {{
            cancelTxStatus === 'preparing' ? 'Preparing…'
            : cancelTxStatus === 'signing' ? 'Waiting for signature…'
            : cancelTxStatus === 'broadcasting' ? 'Broadcasting…'
            : cancelTxStatus === 'in-block' ? 'Cancelling on-chain…'
            : 'Cancel Reported Session'
          }}
        </button>

        <p v-if="cancelError" class="text-xs text-danger leading-snug">
          {{ cancelError }}
        </p>
      </div>

      <div v-if="metadata" class="bg-surface rounded-xl p-4 text-sm">
        <div class="grid grid-cols-1 gap-y-2 sm:grid-cols-2">
          <span class="text-text-muted">Speakers</span>
          <span>{{ metadata.speakers?.join(', ') || 'None' }}</span>
          <span class="text-text-muted">Location</span>
          <span>{{ metadata.location || 'Not set' }}</span>
        </div>
      </div>

      <p v-if="!rolesLoading && !hasAnyRole" class="text-xs text-text-muted bg-surface rounded-xl p-3">
        You don't have a role on this session. Only the session creator and accounts they've granted roles to can manage it.
      </p>
    </div>

    <!-- Check-In Tab (VOLUNTEER / MANAGER / ADMIN) -->
    <div v-if="activeTab === 'checkin'" class="bg-surface rounded-xl p-5 space-y-4">
      <div>
        <p class="text-sm font-medium">Manual Check-In</p>
        <p class="text-xs text-text-muted leading-snug mt-1">
          Attendees must be checked in to the festival before they can be checked in to a session.
        </p>
      </div>

      <div class="flex gap-2">
        <input
          v-model="checkInInput"
          type="text"
          placeholder="Attendee address (SS58 or 0x…)"
          class="flex-1 px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 font-mono focus:outline-none focus:border-primary"
          @input="resetLookup"
          @keyup.enter="lookupAttendee"
        />
        <button
          class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!checkInInput.trim() || isLookingUp"
          @click="lookupAttendee"
        >
          {{ isLookingUp ? 'Checking…' : 'Look up' }}
        </button>
      </div>

      <div
        v-if="lookupState === 'invalid-address'"
        class="rounded-xl bg-danger-muted p-3"
      >
        <p class="text-xs text-danger leading-snug">
          Invalid address. Provide an SS58 or hex (0x…) address.
        </p>
      </div>

      <div
        v-if="lookupState === 'not-festival-checked-in'"
        class="rounded-xl bg-warning-muted p-3"
      >
        <p class="text-sm font-medium text-warning">Festival check-in required</p>
        <p class="text-xs text-text-muted leading-snug mt-1">
          {{ shortenAddress(resolvedAttendeeSs58) }} hasn't checked in to the festival yet. Direct them to the festival check-in desk first; the session check-in will fail otherwise.
        </p>
      </div>

      <div
        v-if="lookupState === 'ready'"
        class="rounded-xl bg-success-muted p-3 flex items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-success">Ready to check in</p>
          <p class="text-xs text-text-muted leading-snug mt-0.5 truncate">
            {{ shortenAddress(resolvedAttendeeSs58) }}
          </p>
        </div>
        <button
          class="shrink-0 px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="checkInBusy"
          @click="performSessionCheckIn"
        >
          {{
            checkInTxStatus === 'preparing' ? 'Preparing…'
            : checkInTxStatus === 'signing' ? 'Sign…'
            : checkInTxStatus === 'broadcasting' ? 'Sending…'
            : checkInTxStatus === 'in-block' ? 'Confirming…'
            : 'Check In'
          }}
        </button>
      </div>

      <p v-if="checkInTxStatus === 'finalized'" class="text-xs text-success">Checked in.</p>
      <p v-if="checkInError" class="text-xs text-danger leading-snug">{{ checkInError }}</p>
    </div>

    <!-- Attendees Tab (any role) -->
    <div v-if="activeTab === 'attendees'" class="bg-surface rounded-xl overflow-x-auto">
      <div v-if="attendeesLoading" class="p-5 text-center text-text-muted text-sm">Loading attendees…</div>
      <div v-else-if="attendees.length === 0" class="p-5 text-center text-text-muted text-sm">No attendees yet.</div>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-border bg-background/50">
            <th class="text-left px-4 py-3 text-xs text-text-muted font-medium">Address</th>
            <th class="text-left px-4 py-3 text-xs text-text-muted font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in attendees" :key="a.address" class="border-b border-border last:border-0">
            <td class="px-4 py-3 font-mono text-xs text-text-muted whitespace-nowrap">{{ displayAccount(a.address) }}</td>
            <td class="px-4 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" :class="a.isCheckedIn ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'">
                {{ a.isCheckedIn ? 'Checked In' : 'Registered' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Settings Tab (ADMIN only) -->
    <div v-if="activeTab === 'settings'" class="space-y-4">
      <div v-if="perms.canEditMetadata.value" class="bg-surface rounded-xl p-5">
        <h3 class="font-medium mb-3">Update Metadata</h3>
        <button class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary">Update CID</button>
      </div>
      <div v-if="perms.canManageRoles.value" class="bg-surface rounded-xl p-5">
        <h3 class="font-medium mb-3">Role Management</h3>
        <p class="text-xs text-text-muted">Grant or revoke roles on this session. This is independent from the parent festival's roles.</p>
      </div>
      <div v-if="perms.canCancel.value" class="bg-danger-muted rounded-xl p-5">
        <h3 class="font-medium text-danger mb-3">Cancel Session</h3>
        <button class="px-4 py-2 bg-danger text-white rounded-2xl text-sm hover:bg-danger/80">Cancel</button>
      </div>
    </div>
  </div>
</template>
