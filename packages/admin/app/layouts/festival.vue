<script setup lang="ts">
import { ref, watch } from 'vue'
import { provideFestivalContext, PUBLISH_CONFLICT } from '~/composables/useFestivalContext'
import { usePermissions } from '~/composables/usePermissions'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { useFestival } from '~/composables/useFestival'
import { useSubEvents } from '~/composables/useSubEvents'
import { useAttendees } from '~/composables/useAttendees'
import { bootLoadAdmin } from '~/composables/useBootLoad'
import { useFestivalWatcher } from '@festival/shared/cache/useFestivalWatcher'
import { useVisibilityReconcile } from '@festival/shared/cache/visibility'
import { startCachePersistence, hydrateLastKnown } from '@festival/shared/cache/festival-state'
import { startPendingReconcile } from '@festival/shared/cache/pending'
import { useMyAddressModal } from '~/composables/useMyAddressModal'

const myAddressModal = useMyAddressModal()

const route = useRoute()
const address = computed(() => route.params.address as string)

const context = provideFestivalContext(address.value)
const permissions = usePermissions(context.userRoles)
const wallet = useWalletStore()
const festival = useFestival(address.value)
// Mounted for their reactive side effects.
useSubEvents(address.value)
useAttendees(address.value)

const showPublishPanel = ref(false)

// Highest-tier role label for the identity chip. Holders may carry multiple
// roles on-chain (legacy grant-cascade); only the effective tier is shown.
const topRoleLabel = computed<string | null>(() => {
  if (permissions.isAdmin.value) return 'ADMIN'
  if (permissions.isManager.value) return 'MANAGER'
  if (permissions.isVolunteer.value) return 'VOLUNTEER'
  return null
})
const mobileMenuOpen = ref(false)

// Close mobile menu on route change
const router = useRouter()
router.afterEach(() => { mobileMenuOpen.value = false })
const isDev = import.meta.dev
const driftError = ref<string | null>(null)

// Persist every state mutation, and paint last-known state before the wallet
// resolves (cache-first).
startCachePersistence()
void hydrateLastKnown(address.value as `0x${string}`)

// Promote/GC optimistic pending entries (check-ins, drafts, cancels) as the
// confirmed tier catches up.
startPendingReconcile()

// Cold-load admin festival state in two Multicall round-trips. Re-runs on
// wallet account switch and route-address change.
function fireBootLoad() {
  const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
  void bootLoadAdmin(address.value as `0x${string}`, userH160)
}
fireBootLoad()
watch(() => wallet.address, fireBootLoad)
watch(address, fireBootLoad)

// Real-time contract event subscription. `deferWhileLoading` lets bootLoad
// finish first so its reads don't race the watcher's chainHead follow init.
const watcher = useFestivalWatcher(address.value as `0x${string}`, {
  onDriftDetected: (msg) => {
    driftError.value = msg
    setTimeout(() => { driftError.value = null }, 8000)
  },
  deferWhileLoading: festival.isLoading,
})

// Visibility change as safety net. Reads at best, like every other state
// source: all festival state is monotonic, so a finalized read could only
// regress fresher best-derived state (e.g. revert a just-landed check-in).
useVisibilityReconcile(async () => {
  const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
  await bootLoadAdmin(address.value as `0x${string}`, userH160)
  // The chainHead follow may have died silently while backgrounded; re-open it.
  watcher?.restart()
})

function shortenAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

async function handlePublish() {
  await context.publish()
  if (context.txStatus.value !== 'error') {
    showPublishPanel.value = false
  }
}

// Pull the latest published metadata into the draft (discarding unsaved edits),
// so the user can re-apply their changes against current on-chain state.
function handleRefreshFromChain() {
  context.discardChanges()
  context.txError.value = null
  showPublishPanel.value = false
}
</script>

<template>
  <div class="h-screen flex flex-col lg:flex-row" data-testid="admin-layout-ready">
    <!-- Mobile header -->
    <header class="lg:hidden sticky top-0 h-14 bg-surface z-40 flex items-center px-4 gap-3 shrink-0">
      <button
        class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/8 transition-colors -ml-1"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <svg v-if="!mobileMenuOpen" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      <h2 class="font-heading text-sm font-bold">Festival</h2>
      <p class="text-xs font-mono text-text-muted">{{ shortenAddr(address) }}</p>
    </header>

    <!-- Mobile nav overlay -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition duration-150"
        leave-to-class="opacity-0"
      >
        <div v-if="mobileMenuOpen" class="fixed inset-0 z-50 lg:hidden" @click.self="mobileMenuOpen = false">
          <div class="absolute inset-0 bg-black/80" @click="mobileMenuOpen = false" />
          <nav class="relative w-72 h-full bg-surface p-4 flex flex-col overflow-y-auto">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-heading text-lg font-bold">Festival</h2>
              <button class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/8" @click="mobileMenuOpen = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <p class="text-xs font-mono text-text-muted mb-2">{{ shortenAddr(address) }}</p>
            <template v-if="context.rolesReady.value">
              <div v-if="topRoleLabel" class="flex flex-wrap gap-1 mb-5">
                <span class="text-[10px] px-1.5 py-0.5 bg-white/10 text-text-secondary rounded font-medium">{{ topRoleLabel }}</span>
              </div>

              <div class="flex-1 space-y-1">
                <NuxtLink
                  v-for="item in permissions.navItems.value"
                  :key="item.to"
                  :to="`/festival/${address}${item.to}`"
                  :data-testid="`nav-item-${item.to === '' ? 'overview' : item.to.slice(1)}`"
                  class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors"
                  active-class="!bg-white/8 !text-text-primary font-medium"
                  :exact="item.to === ''"
                >
                  {{ item.label }}
                </NuxtLink>
              </div>
            </template>
            <div v-else class="flex-1" />

            <!-- Changes + wallet in mobile overlay -->
            <div v-if="context.isDirty.value && context.totalChangeCount.value > 0 && permissions.canEditMetadata.value" class="border-t border-border pt-4 mt-3">
              <div class="bg-warning/15 rounded-lg p-3 mb-3">
                <p class="text-xs font-medium text-warning mb-1">{{ context.totalChangeCount.value }} unpublished change{{ context.totalChangeCount.value !== 1 ? 's' : '' }}</p>
              </div>
              <div class="flex gap-2">
                <button class="flex-1 px-3 py-2 bg-primary text-black rounded-lg text-xs font-medium" @click="showPublishPanel = true; mobileMenuOpen = false">Publish</button>
                <button class="px-3 py-2 bg-secondary-btn rounded-lg text-xs text-text-secondary" @click="context.discardChanges()">Discard</button>
              </div>
            </div>

            <div class="border-t border-border pt-4 mt-4">
              <button
                v-if="wallet.isConnected"
                class="w-full text-left hover:bg-white/8 rounded-lg p-1.5 -m-1.5 transition-colors"
                @click="myAddressModal.open(); mobileMenuOpen = false"
              >
                <p class="text-xs text-text-muted">Connected</p>
                <p class="text-sm font-medium truncate">{{ wallet.accountName }}</p>
                <p class="text-xs text-text-muted font-mono">{{ wallet.truncatedAddress }}</p>
              </button>
              <p v-else class="text-xs text-text-muted">No wallet connected</p>
              <p v-if="isDev" class="text-[10px] text-primary mt-1">DEV MODE</p>
            </div>
          </nav>
        </div>
      </Transition>
    </Teleport>

    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex w-64 bg-surface p-4 flex-col shrink-0 overflow-y-auto">
      <h2 class="font-heading text-lg font-bold mb-1">Festival</h2>
      <p class="text-xs font-mono text-text-muted mb-2">{{ shortenAddr(address) }}</p>
      <template v-if="context.rolesReady.value">
        <div v-if="topRoleLabel" class="flex flex-wrap gap-1 mb-5">
          <span class="text-[10px] px-1.5 py-0.5 bg-white/10 text-text-secondary rounded font-medium">
            {{ topRoleLabel }}
          </span>
        </div>

        <nav class="flex-1 space-y-1">
          <NuxtLink
            v-for="item in permissions.navItems.value"
            :key="item.to"
            :to="`/festival/${address}${item.to}`"
            :data-testid="`nav-item-${item.to === '' ? 'overview' : item.to.slice(1)}`"
            class="block px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/8 hover:text-text-primary transition-colors"
            active-class="!bg-white/8 !text-text-primary font-medium"
            :exact="item.to === ''"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
      </template>
      <div v-else class="flex-1" />

      <!-- Unpublished changes indicator -->
      <div v-if="context.isDirty.value && context.totalChangeCount.value > 0 && permissions.canEditMetadata.value" class="border-t border-border pt-4 mt-3">
        <NuxtLink
          :to="`/festival/${address}/changes`"
          class="block px-3 py-2 mb-3 rounded-lg text-sm font-medium text-warning bg-warning-muted hover:bg-warning/20 transition-colors"
        >
          Review Changes ({{ context.totalChangeCount.value }})
        </NuxtLink>
      </div>

      <div v-if="context.isDirty.value && context.totalChangeCount.value > 0 && permissions.canEditMetadata.value" class="">
        <div class="bg-warning/15 rounded-lg p-3 mb-3">
          <p class="text-xs font-medium text-warning mb-1">Unpublished changes</p>
          <ul class="text-[11px] text-warning/80 space-y-0.5">
            <li v-for="section in context.changedSections.value" :key="section">· {{ section }}</li>
          </ul>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 px-3 py-2 bg-primary text-black rounded-lg text-xs font-medium hover:bg-primary-hover transition-colors"
            @click="showPublishPanel = true"
          >
            Publish
          </button>
          <button
            class="px-3 py-2 bg-secondary-btn rounded-lg text-xs text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors"
            @click="context.discardChanges()"
          >
            Discard
          </button>
        </div>
      </div>

      <div class="border-t border-border pt-4 mt-4">
        <button
          v-if="wallet.isConnected"
          class="w-full text-left hover:bg-white/8 rounded-lg p-1.5 -m-1.5 transition-colors"
          @click="myAddressModal.open()"
        >
          <p class="text-xs text-text-muted">Connected</p>
          <p class="text-sm font-medium truncate">{{ wallet.accountName }}</p>
          <p class="text-xs text-text-muted font-mono">{{ wallet.truncatedAddress }}</p>
        </button>
        <p v-else class="text-xs text-text-muted">No wallet connected</p>
        <p v-if="isDev" class="text-[10px] text-primary mt-1">DEV MODE</p>
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 p-4 lg:p-6 overflow-y-auto">
      <!-- Waiting for roles -->
      <div v-if="!context.rolesReady.value" />
      <!-- No role -->
      <div v-else-if="context.userRoles.value.length === 0" class="flex items-center justify-center h-full" data-testid="no-role-message">
        <div class="text-center max-w-sm">
          <p class="text-lg font-medium mb-2">No organizational role</p>
          <p class="text-sm text-text-secondary">
            Your connected account does not have any role in this festival. Switch to an account with admin or manager permissions to manage this festival.
          </p>
        </div>
      </div>
      <slot v-else />
    </main>

    <!-- Drift error toast -->
    <Teleport to="body">
      <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-2" leave-active-class="transition duration-150" leave-to-class="opacity-0 translate-y-2">
        <div v-if="driftError" class="fixed bottom-4 left-4 z-50 bg-danger-muted rounded-lg px-4 py-3 shadow-lg max-w-sm">
          <p class="text-sm text-danger">{{ driftError }}</p>
        </div>
      </Transition>
    </Teleport>

    <!-- Remote-change banner: an external publish landed while editing. Persistent
         (no auto-dismiss) with an explicit refresh/keep-editing choice. -->
    <Teleport to="body">
      <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0 translate-y-2" leave-active-class="transition duration-150" leave-to-class="opacity-0 translate-y-2">
        <div v-if="context.remoteChanged.value" data-testid="remote-change-banner" class="fixed bottom-4 left-4 z-50 bg-warning-muted rounded-lg px-4 py-3 shadow-lg max-w-sm">
          <p class="text-sm text-warning mb-2">
            This festival was updated on chain elsewhere. The latest data is loaded; your unpublished edits are preserved. Refresh to edit against the latest, or keep editing and resolve on publish.
          </p>
          <div class="flex gap-2">
            <button
              data-testid="remote-change-refresh"
              class="px-3 py-1.5 bg-warning text-black rounded-xl text-xs font-medium hover:bg-warning/80 transition-colors"
              @click="handleRefreshFromChain"
            >
              Refresh from chain
            </button>
            <button
              class="px-3 py-1.5 bg-secondary-btn rounded-xl text-xs text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors"
              @click="context.acknowledgeRemoteChange()"
            >
              Keep editing
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Publish confirmation -->
    <Teleport to="body">
      <Transition enter-active-class="transition duration-200" enter-from-class="opacity-0" leave-active-class="transition duration-150" leave-to-class="opacity-0">
        <div v-if="showPublishPanel" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="bg-surface rounded-3xl p-4 sm:p-6 mx-4 max-w-md w-full">
            <h3 class="font-heading text-lg font-bold mb-3">Publish changes</h3>
            <p class="text-sm text-text-secondary mb-2">
              This uploads the updated metadata to the Bulletin Chain and updates the on-chain CID. Everyone — attendees, staff, other admins — will see the new data immediately.
            </p>
            <p class="text-sm text-warning bg-warning-muted rounded-lg px-3 py-2 mb-4">
              We strongly recommend reviewing your changes before publishing.
            </p>

            <div class="bg-background rounded-lg p-3 mb-4">
              <p class="text-xs font-medium text-text-muted mb-2">{{ context.totalChangeCount.value }} change{{ context.totalChangeCount.value !== 1 ? 's' : '' }} across:</p>
              <ul class="text-sm space-y-1">
                <li v-for="section in context.changedSections.value" :key="section" class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-warning rounded-full shrink-0" />
                  {{ section }}
                </li>
              </ul>
            </div>

            <div v-if="context.txStatus.value !== 'idle' && context.txStatus.value !== 'error'" class="bg-surface-2 rounded-lg p-4 mb-4">
              <div class="flex items-center gap-3">
                <div v-if="context.txStatus.value !== 'finalized'" class="w-5 h-5 border-2 border-text-primary border-t-transparent rounded-full animate-spin shrink-0" />
                <div>
                  <p class="text-sm font-medium">
                    {{ context.txStatus.value === 'preparing' ? 'Saving metadata to Polkadot Cloud…' : '' }}
                    {{ context.txStatus.value === 'signing' ? 'Waiting for your signature…' : '' }}
                    {{ context.txStatus.value === 'broadcasting' ? 'Broadcasting transaction…' : '' }}
                    {{ context.txStatus.value === 'in-block' ? 'Updating on-chain metadata…' : '' }}
                    {{ context.txStatus.value === 'finalized' ? 'Published!' : '' }}
                  </p>
                  <p class="text-xs text-text-muted mt-0.5">
                    {{ context.txStatus.value === 'preparing' ? 'Storing your updated festival details on the Polkadot Bulletin Chain' : '' }}
                    {{ context.txStatus.value === 'signing' ? 'Approve the transaction in your wallet to update the on-chain CID' : '' }}
                    {{ context.txStatus.value === 'broadcasting' ? 'Sending your transaction to the network' : '' }}
                    {{ context.txStatus.value === 'in-block' ? 'Transaction included in a block, waiting for confirmation' : '' }}
                    {{ context.txStatus.value === 'finalized' ? 'Your changes are now live for all attendees' : '' }}
                  </p>
                </div>
              </div>
            </div>

            <div v-if="context.txError.value" class="bg-danger-muted rounded-lg p-3 mb-4 text-sm text-danger">
              <template v-if="context.txError.value === PUBLISH_CONFLICT">
                <p class="mb-2">
                  Someone else published changes since you started editing. The latest on-chain data has been loaded — refresh to edit against it, then re-apply your changes and publish.
                </p>
                <button
                  data-testid="conflict-refresh"
                  class="px-3 py-1.5 bg-danger/20 rounded-xl text-xs font-medium hover:bg-danger/30 transition-colors"
                  @click="handleRefreshFromChain"
                >
                  Refresh from chain
                </button>
              </template>
              <template v-else>{{ context.txError.value }}</template>
            </div>

            <div class="flex gap-2 justify-end">
              <button
                class="px-4 py-2 bg-secondary-btn rounded-2xl text-sm text-text-secondary hover:bg-secondary-btn-hover hover:text-text-primary transition-colors"
                :disabled="context.txStatus.value !== 'idle' && context.txStatus.value !== 'error' && context.txStatus.value !== 'finalized'"
                @click="showPublishPanel = false"
              >
                Cancel
              </button>
              <NuxtLink
                :to="`/festival/${address}/changes`"
                class="px-4 py-2 bg-warning-muted rounded-2xl text-sm text-warning hover:bg-warning/20 transition-colors"
                @click="showPublishPanel = false"
              >
                Review Changes
              </NuxtLink>
              <button
                class="px-4 py-2 bg-primary text-black rounded-2xl text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                :disabled="context.txStatus.value !== 'idle' && context.txStatus.value !== 'error'"
                @click="handlePublish"
              >
                {{ context.txStatus.value === 'idle' || context.txStatus.value === 'error' ? 'Publish Now' : 'Publishing…' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
