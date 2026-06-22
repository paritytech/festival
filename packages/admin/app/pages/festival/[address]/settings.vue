<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFestival } from '~/composables/useFestival'
import { useFestivalContext } from '~/composables/useFestivalContext'
import { usePermissions } from '~/composables/usePermissions'
import { useRoles, ROLE_OPTIONS } from '~/composables/useRoles'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { h160ToSs58, isValidEvmAddress, shortenAddress } from '@festival/shared/utils/address'

definePageMeta({ layout: 'festival' })

const route = useRoute()
const address = route.params.address as string
const { metadata, details, reload } = useFestival(address)
const { userRoles } = useFestivalContext()
const { canManageRoles, canEditCapacity, canCancel } = usePermissions(userRoles)
const { holders, grantRole, revokeRole, txStatus: roleTxStatus } = useRoles(address)

// Role grant form
const newRoleAddress = ref('')
const newRoleType = ref(ROLE_OPTIONS[2].value) // Volunteer default
const grantScanning = ref(false)

async function handleGrantRole() {
  if (!newRoleAddress.value) return
  await grantRole(newRoleType.value, newRoleAddress.value)
  newRoleAddress.value = ''
}

function onGrantScan(data: string) {
  grantScanning.value = false
  newRoleAddress.value = data.trim()
}

// Dedup holders: show only the highest-rank role per address
const ROLE_RANK: Record<string, number> = { Admin: 3, Manager: 2, Volunteer: 1 }

const displayHolders = computed(() => {
  const map = new Map<string, { address: string; highestRole: string; rank: number }>()
  for (const holder of holders.value) {
    for (const role of holder.roles) {
      const rank = ROLE_RANK[role] ?? 0
      const existing = map.get(holder.address)
      if (!existing || rank > existing.rank) {
        map.set(holder.address, { address: holder.address, highestRole: role, rank })
      }
    }
  }
  return [...map.values()].sort((a, b) => b.rank - a.rank)
})

async function handleChangeRole(address: string, newRole: `0x${string}`) {
  await grantRole(newRole, address)
}

async function handleRemoveHolder(address: string) {
  const holder = holders.value.find(h => h.address === address)
  if (!holder) return
  for (const roleName of holder.roles) {
    const opt = ROLE_OPTIONS.find(o => o.label === roleName)
    if (opt) await revokeRole(opt.value, address)
  }
}

// Capacity update
const newCapacity = ref<number | undefined>(undefined)
const capacityTxStatus = ref<TxStatus>('idle')
const capacityError = ref<string | null>(null)

async function handleUpdateCapacity() {
  if (newCapacity.value === undefined) return
  capacityError.value = null
  capacityTxStatus.value = 'preparing'

  try {
    const wallet = useWalletStore()
    const targetCapacity = newCapacity.value
    await writeContract({
      address: address as `0x${string}`,
      abi: FestivalABI,
      functionName: 'updateCapacity',
      args: [targetCapacity],
      signer: wallet.getSigner(),
      walletAddress: wallet.address,
      onStatus: (s) => {
        capacityTxStatus.value = s
        if (s === 'in-block' && details.value) {
          details.value = { ...details.value, capacity: targetCapacity }
          newCapacity.value = undefined
        }
      },
    })
  } catch (e) {
    capacityTxStatus.value = 'error'
    capacityError.value = formatTxError(e)
  }
}

// Cancel festival
const showCancelConfirm = ref(false)
const cancelTxStatus = ref<TxStatus>('idle')
const cancelError = ref<string | null>(null)
const cancelBusy = computed(() =>
  cancelTxStatus.value === 'preparing' || cancelTxStatus.value === 'signing' || cancelTxStatus.value === 'broadcasting',
)

async function handleCancel() {
  cancelError.value = null
  cancelTxStatus.value = 'preparing'

  try {
    const wallet = useWalletStore()
    await writeContract({
      address: address as `0x${string}`,
      abi: FestivalABI,
      functionName: 'cancel',
      args: [],
      signer: wallet.getSigner(),
      walletAddress: wallet.address,
      onStatus: (s) => {
        cancelTxStatus.value = s
        if (s === 'in-block') {
          if (details.value) details.value = { ...details.value, cancelled: true }
          showCancelConfirm.value = false
        }
      },
    })
  } catch (e) {
    cancelTxStatus.value = 'error'
    cancelError.value = formatTxError(e)
  }
}

function displayAccount(addr: string) {
  const ss58 = isValidEvmAddress(addr) ? h160ToSs58(addr) : addr
  return shortenAddress(ss58, 10, 6)
}
</script>

<template>
  <div class="space-y-8">
    <h2 class="font-heading text-2xl font-bold" data-testid="settings-heading">Settings</h2>

    <!-- Role Management (ADMIN only) -->
    <section v-if="canManageRoles" class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-4">Role Management</h3>

      <!-- Current holders (deduped, highest rank only) -->
      <div v-if="displayHolders.length" class="mb-4 space-y-2">
        <div
          v-for="holder in displayHolders"
          :key="holder.address"
          class="flex items-center justify-between bg-background rounded-xl px-3 py-2"
        >
          <p class="font-mono text-xs min-w-0 truncate">{{ displayAccount(holder.address) }}</p>
          <div class="flex items-center gap-2 shrink-0">
            <select
              :value="ROLE_OPTIONS.find(o => o.label === holder.highestRole)?.value"
              class="px-2 py-1 border border-border rounded-lg text-xs bg-surface-2"
              @change="handleChangeRole(holder.address, ($event.target as HTMLSelectElement).value as `0x${string}`)"
            >
              <option v-for="opt in ROLE_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <button
              class="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
              title="Remove all roles"
              @click="handleRemoveHolder(holder.address)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Grant new role -->
      <div class="border-t border-border pt-4">
        <p class="text-sm font-medium mb-2">Grant Role</p>
        <QRScanner v-if="grantScanning" :active="true" class="mb-3" @scan="onGrantScan" />
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            v-model="newRoleAddress"
            type="text"
            placeholder="Address (SS58 or 0x)"
            class="flex-1 px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 font-mono focus:outline-none focus:border-primary"
          />
          <select
            v-model="newRoleType"
            class="px-3 py-2 border border-border rounded-xl text-sm bg-surface-2"
          >
            <option v-for="opt in ROLE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <button
            class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors whitespace-nowrap"
            @click="grantScanning = !grantScanning"
          >
            {{ grantScanning ? 'Cancel Scan' : 'Scan QR' }}
          </button>
          <button
            class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors whitespace-nowrap disabled:opacity-50"
            :disabled="!newRoleAddress || roleTxStatus === 'preparing'"
            @click="handleGrantRole"
          >
            Grant
          </button>
        </div>
      </div>
    </section>

    <!-- Session Settings (read-only display) -->
    <section v-if="details" class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-4">Session Settings</h3>

      <div class="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6 text-sm">
        <div>
          <p class="text-text-muted text-xs">Sessions</p>
          <p>{{ details.sessionsEnabled ? 'Enabled' : 'Disabled' }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Creation Access</p>
          <p>POAP holders</p>
        </div>
      </div>
    </section>

    <!-- Capacity (MANAGER+) -->
    <section v-if="canEditCapacity" class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-3">Capacity</h3>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          v-model.number="newCapacity"
          type="number"
          min="0"
          :placeholder="String(details?.capacity || 0)"
          class="w-full sm:w-32 px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary"
          data-testid="capacity-input"
        />
        <button
          class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          data-testid="capacity-update-btn"
          :disabled="newCapacity === undefined || capacityTxStatus === 'preparing' || capacityTxStatus === 'signing' || capacityTxStatus === 'broadcasting'"
          @click="handleUpdateCapacity"
        >
          {{ capacityTxStatus === 'preparing' || capacityTxStatus === 'signing' || capacityTxStatus === 'broadcasting' ? 'Updating…' : 'Update' }}
        </button>
      </div>
      <p class="text-xs text-text-muted mt-1">Set to 0 for unlimited. Cannot reduce below current registered count.</p>
      <p v-if="capacityError" class="text-xs text-danger mt-1">{{ capacityError }}</p>
    </section>

    <!-- Danger Zone (ADMIN only) -->
    <section v-if="canCancel" class="bg-danger-muted rounded-xl p-5">
      <h3 class="font-medium text-danger mb-3">Danger Zone</h3>

      <div v-if="!showCancelConfirm">
        <p class="text-sm text-text-secondary mb-3">
          Cancelling a festival is irreversible. It blocks registration, check-in, and session creation.
        </p>
        <button
          class="px-4 py-2 bg-danger text-white rounded-2xl text-sm hover:bg-danger/80 transition-colors"
          data-testid="cancel-festival-btn"
          :disabled="details?.cancelled"
          @click="showCancelConfirm = true"
        >
          {{ details?.cancelled ? 'Already Cancelled' : 'Cancel Festival' }}
        </button>
      </div>

      <div v-else class="bg-danger-muted rounded-xl p-4">
        <p class="text-sm font-medium text-danger mb-3">Are you sure? This cannot be undone.</p>
        <div class="flex gap-2">
          <button
            class="px-4 py-2 bg-danger text-white rounded-2xl text-sm hover:bg-danger/80 disabled:opacity-50"
            data-testid="cancel-confirm-btn"
            :disabled="cancelBusy"
            @click="handleCancel"
          >
            {{ cancelBusy ? 'Cancelling…' : 'Yes, Cancel Festival' }}
          </button>
          <button
            class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary"
            data-testid="cancel-keep-btn"
            :disabled="cancelBusy"
            @click="showCancelConfirm = false"
          >
            No, Keep It
          </button>
        </div>
        <p v-if="cancelError" class="text-xs text-danger mt-2">{{ cancelError }}</p>
      </div>
    </section>
  </div>
</template>
