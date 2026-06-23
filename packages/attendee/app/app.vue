<script setup lang="ts">
import { ref, computed, provide, watch } from 'vue'
import LoadingSplash from '~/components/LoadingSplash.vue'
import SuccessToast from '~/components/SuccessToast.vue'
import { useBookmarks } from '~/composables/useBookmarks'
import { bootApp } from '@festival/shared/host/boot'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160, ss58ToH160, isValidEvmAddress } from '@festival/shared/utils/address'
import { useRegistration } from '~/composables/useRegistration'
import { useFestival } from '~/composables/useFestival'
import { useSubEvents } from '~/composables/useSubEvents'
import { usePoaps } from '~/composables/usePoaps'
import { bootLoadAttendee } from '~/composables/useBootLoad'
import { refreshUserFestivalPoaps, refreshUserSessionPoaps } from '~/composables/usePoapRefresh'
import { startCachePersistence, hydrateLastKnown } from '@festival/shared/cache/festival-state'
import { startPendingReconcile } from '@festival/shared/cache/pending'
import { useFestivalWatcher } from '@festival/shared/cache/useFestivalWatcher'
import { useVisibilityReconcile } from '@festival/shared/cache/visibility'
import { useAnnouncements } from '~/composables/useAnnouncements'
import { useFestivalPass } from '~/composables/useFestivalPass'
import { APP_SCROLLER_KEY } from '~/composables/appScroller'
import FestivalPassScreen from '~/components/FestivalPassScreen.vue'
import ActivationModal from '~/components/ActivationModal.vue'
import BadgeEarnedFestivalScreen from '~/components/BadgeEarnedFestivalScreen.vue'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'

const { allowed, environment } = bootApp()
const isDev = import.meta.dev
const isConfigured = hasDeployedContracts()
const registration = useRegistration(FESTIVAL_ADDRESS)
const { isRegistered } = registration
const festival = useFestival()
const { metadata: festivalMetadata } = festival
// Mounted for their reactive side effects (watchers, image resolvers).
useSubEvents()
usePoaps()

const buildHash = import.meta.env.VITE_BUILD_HASH || ''
const buildDate = import.meta.env.VITE_BUILD_DATE || ''
if (buildHash) {
  console.log(`[w3s-festival] build: ${buildHash.slice(0, 7)} (${buildDate})`)
} else if (isDev) {
  console.log('[w3s-festival] dev')
}
const wallet = useWalletStore()
const showAccountPicker = ref(false)

// Festival Pass + Badge overlays live at the shell so they aren't tied to
// <KeepAlive>'d page state. The composable's overlayGate also requires
// route.path === '/' — together, the overlay can only exist while the user
// is actually on home.
const {
  shouldShowPass,
  shouldShowBadge,
  isActivating: isPassActivating,
  isExploding: isPassExploding,
  activatedAtMs,
  activationFailed,
  activate: onActivatePass,
  retryActivation: onRetryActivation,
  defer: onDeferPass,
  dismissBadge: onBadgeNext,
} = useFestivalPass()

const userH160 = computed(() => {
  if (!wallet.isConnected) return null
  if (!hasDeployedContracts()) return '0x' + '0'.repeat(39) + '1'
  return isValidEvmAddress(wallet.address)
    ? wallet.address.toLowerCase()
    : ss58ToH160(wallet.address).toLowerCase()
})

// Cold-load the entire festival state in two Multicall round-trips. We
// skip the initial fire when the wallet hasn't connected yet — the
// `wallet.address` watcher below will run it once the user resolves,
// avoiding a duplicate bootLoad (initial + on-connect).
// Persist every festivalState mutation (watcher events, optimistic flips, boot
// reads), not just boot-load success, so a cold restart paints last-known state.
startCachePersistence()

// Cache-first paint: hydrate last-known state immediately, before the wallet
// resolves, so a slow or failed connection doesn't leave the UI blank.
void hydrateLastKnown(FESTIVAL_ADDRESS)

// Promote/GC optimistic pending entries as the confirmed tier catches up.
startPendingReconcile()

function fireBootLoad() {
  if (!wallet.isConnected) return
  const userH160 = walletAddressToH160(wallet.address)
  void bootLoadAttendee(userH160)
}
fireBootLoad()
watch(() => wallet.address, fireBootLoad)

const announcements = useAnnouncements()

// Real-time contract event subscription. `deferWhileLoading` waits until the
// initial bootLoad finishes so the watcher's chainHead_v1_follow init doesn't
// race with our `ReviveApi.call` reads — bootLoad-first means at least the
// initial state lands before the watcher's heavier follow-init might trip
// the host's rate limiter.
const watcher = useFestivalWatcher(FESTIVAL_ADDRESS, {
  deferWhileLoading: festival.isLoading,
  onChannelMetadataUpdated: () => { void announcements.reload() },
  // Live-populate the user's own POAP on check-in so the badge appears at once,
  // instead of waiting for the next reconcile. Gated to self.
  onCheckedIn: (attendee) => {
    if (!wallet.isConnected) return
    const me = walletAddressToH160(wallet.address)
    if (attendee.toLowerCase() === me.toLowerCase()) void refreshUserFestivalPoaps(me)
  },
  onSessionCheckedIn: (sessionAddress, attendee) => {
    if (!wallet.isConnected) return
    const me = walletAddressToH160(wallet.address)
    if (attendee.toLowerCase() === me.toLowerCase()) void refreshUserSessionPoaps(me, sessionAddress)
  },
})

// Visibility change as safety net — catches events lost during WebSocket
// suspension. Reads at best, like every other state source (watcher, tx
// tracking): all festival state is monotonic, so a finalized read could only
// regress fresher best-derived state (e.g. revert a just-landed check-in for
// the length of the finality lag).
useVisibilityReconcile(async () => {
  const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
  void announcements.reloadIfChanged()
  await bootLoadAttendee(userH160)
  // The chainHead follow may have died silently while backgrounded; re-open it.
  watcher?.restart()
})

function shortenAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

const route = useRoute()

const hideChrome = computed(() => route.path === '/onboarding')

const hideTabBar = computed(() =>
  route.path === '/onboarding' ||
  route.path.includes('/manage/') ||
  route.path === '/sessions/create' ||
  route.path === '/sessions/host' ||
  route.path.startsWith('/sessions/') ||
  route.path === '/my/badges' ||
  route.path === '/my/badges/welcome' ||
  (route.path.startsWith('/program/') && route.path !== '/program'),
)

// Single source of truth for navigation — rendered as bottom tab bar on mobile
// and as sidebar on desktop (see docs/desktop-layout.md).
const navItems = [
  { to: '/', label: 'Home', exact: true, icon: 'home' as const },
  { to: '/map', label: 'Map', exact: false, icon: 'map' as const },
  { to: '/program', label: 'Program', exact: false, icon: 'program' as const },
] as const

function isTabActive(tab: typeof navItems[number]): boolean {
  if (tab.exact) return route.path === tab.to
  return route.path.startsWith(tab.to)
}

// Provide the scroll container to descendants. Pages need it for scroll
// position / scrollTo / scroll listeners since the document doesn't scroll.
const scroller = ref<HTMLElement | null>(null)
provide(APP_SCROLLER_KEY, scroller)

// Cold-boot splash. Plays a fixed 4s cycle (expand → hold → collapse) that
// masks the cache→chain repaint flash while the boot reads run underneath.
// Self-times via CSS animation; we just unmount on the @done event.
//
// Only shown on a fresh landing at the home route ('/'). Deep-linked entries
// (#/map, #/onboarding, …) skip the splash entirely. We read the entry hash
// directly rather than route.path because the router's initial navigation may
// not have resolved during setup (hash mode resolves async on hard load).
const entryPath = window.location.hash.replace(/^#/, '').split('?')[0] || '/'
const showSplash = ref(entryPath === '/')
function onSplashDone() {
  showSplash.value = false
}

// Global toast for bookmark scheduling failures — fires from useBookmarks
// when the host can't schedule the reminder (cap reached or permission denied).
const { bookmarkAlert, clearBookmarkAlert } = useBookmarks()
const bookmarkAlertMessage = computed(() => {
  if (!bookmarkAlert.value) return ''
  return bookmarkAlert.value.kind === 'limit-reached'
    ? "Reminder couldn't be scheduled — too many pending notifications."
    : 'Reminder needs notification permission to be enabled.'
})
</script>

<template>
  <div v-if="!allowed && !isDev" class="min-h-screen flex items-center justify-center bg-background p-8">
    <div class="text-center max-w-md">
      <h1 class="text-2xl font-bold mb-4">Festival</h1>
      <p class="text-text-secondary mb-6">
        This app runs inside the Polkadot Host. Open it from Polkadot Desktop, Web, or Mobile.
      </p>
      <p class="text-text-muted text-sm">
        Detected environment: {{ environment }}
      </p>
    </div>
  </div>

  <div v-else-if="!isConfigured && !isDev" class="min-h-screen flex items-center justify-center bg-background p-8">
    <div class="text-center max-w-md">
      <h1 class="text-2xl font-bold mb-4">Missing Configuration</h1>
      <p class="text-text-secondary">
        VITE_FESTIVAL_ADDRESS environment variable is required.
      </p>
    </div>
  </div>

  <!-- Main app shell.
       A fixed-height flex column so the bottom nav is always a sibling of
       the scroll area, never a `position: fixed` overlay. iOS WebKit can
       drift the layout viewport (rubber-band, momentum scrolling, viewport
       meta quirks) — none of that can move the nav now. -->
  <div v-else class="app-shell">
      <!-- Desktop sidebar (hidden on mobile) -->
      <aside
        class="hidden md:flex md:fixed md:top-0 md:left-0 md:bottom-0 md:w-60 md:flex-col md:gap-1 md:border-r md:border-white/8 md:z-30 md:px-4 md:py-6"
        data-testid="attendee-sidebar"
      >
        <p class="text-sm font-semibold text-white/80 tracking-widest uppercase px-2 mb-5">
          Festival
        </p>
        <NuxtLink
          v-for="tab in navItems"
          v-show="!hideChrome"
          :key="tab.to"
          :to="tab.to"
          :data-testid="`nav-item-${tab.label.toLowerCase()}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
          :class="isTabActive(tab) ? 'bg-surface-2 text-white' : 'text-white/60 hover:text-white hover:bg-surface/60'"
        >
          <NavTabIcon :icon="tab.icon" :size="22" />
          <span class="text-sm font-medium">{{ tab.label }}</span>
        </NuxtLink>
      </aside>

      <!-- Desktop right pane (empty in PR 1, reserved for two-pane detail) -->
      <aside
        class="hidden md:block md:fixed md:top-0 md:bottom-0 md:right-0 md:bg-background md:border-l md:border-white/8 md:z-10"
        :style="{ width: 'var(--col-r)' }"
      />

      <!-- Main column — itself a flex column so <main> can flex-fill and
           the nav sits as the last sibling. -->
      <div class="relative md:ml-60 md:w-[var(--col-w)] flex flex-col flex-1 min-h-0">
        <!-- Connection status banner — scoped to the main column at md+ -->
        <div
          v-if="wallet.connectionStatus === 'disconnected'"
          class="fixed top-0 left-0 right-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[100] bg-warning/90 text-white text-center py-2 text-sm font-medium"
        >
          Reconnecting to host...
        </div>

        <!-- Dev account picker — pinned to the bottom-right of the main column,
             clear of the home-page bell (top-right) and the tab bar (bottom). -->
        <div
          v-if="isDev"
          class="fixed bottom-16 right-0 md:bottom-2 md:right-[var(--col-r)] z-[60] p-2"
        >
          <button
            v-if="wallet.isConnected"
            class="text-right rounded-lg px-2 py-1 bg-surface/70 backdrop-blur hover:bg-surface-2 transition-colors"
            @click="showAccountPicker = !showAccountPicker"
          >
            <p class="text-[10px] text-text-muted truncate max-w-[120px]">{{ wallet.accountName }}</p>
            <p class="text-[9px] text-violet">DEV</p>
          </button>
          <p v-else class="text-[10px] text-text-muted px-2 py-1">No wallet</p>

          <div
            v-if="showAccountPicker && wallet.accounts.length > 1"
            class="absolute right-2 bottom-full mb-1 w-56 bg-surface-2 border border-border rounded-xl shadow-lg z-50 overflow-hidden"
          >
            <button
              v-for="acc in wallet.accounts"
              :key="acc.address"
              class="w-full text-left px-3 py-2 text-xs hover:bg-surface-3 transition-colors border-b border-border last:border-b-0"
              :class="acc.address === wallet.address ? 'font-medium text-text-primary' : 'text-text-secondary'"
              @click="wallet.selectAccount(acc); showAccountPicker = false"
            >
              <p class="truncate">{{ acc.name || 'Account' }}</p>
              <p class="text-text-muted text-[10px]">{{ shortenAddr(acc.address) }}</p>
            </button>
          </div>
        </div>

        <!-- Main content. Capped at max-w-md on mobile (centers content on
             tablet-portrait viewports); spans the middle column at md+.
             The ONLY scroller in the app — see main.css. -->
        <main
          ref="scroller"
          data-app-scroller
          class="app-scroll-area px-4 mx-auto w-full max-w-md md:max-w-none md:mx-0"
        >
          <NuxtPage v-slot="{ Component }">
            <KeepAlive :max="10">
              <component :is="Component" :key="$route.path" />
            </KeepAlive>
          </NuxtPage>
        </main>

        <!-- Bottom tab bar (mobile only). A static flex sibling of <main> —
             cannot drift, regardless of WebKit viewport quirks. -->
        <nav
          v-if="!hideTabBar"
          class="relative z-50 md:hidden bg-black border-t border-white/12 shrink-0 pb-[var(--safe-bottom)]"
          data-testid="attendee-tab-bar"
        >
          <div class="flex items-center justify-around h-[52px]">
            <NuxtLink
              v-for="tab in navItems"
              :key="tab.to"
              :to="tab.to"
              :data-testid="`tab-${tab.label.toLowerCase()}`"
              class="flex flex-col items-center gap-0.5 px-5 py-1 min-w-[64px] transition-colors"
              :class="isTabActive(tab) ? 'text-white' : 'text-white/50'"
            >
              <NavTabIcon :icon="tab.icon" :size="26" />
              <span class="text-[10px] font-medium">{{ tab.label }}</span>
            </NuxtLink>
          </div>
        </nav>
      </div>
  </div>

  <!-- Global bookmark scheduling alert (cap reached / permission denied). -->
  <div
    v-if="bookmarkAlert"
    class="fixed top-4 left-1/2 -translate-x-1/2 z-[200]"
    data-testid="bookmark-alert-toast"
  >
    <SuccessToast
      :visible="!!bookmarkAlert"
      variant="check"
      :message="bookmarkAlertMessage"
      @hide="clearBookmarkAlert"
    />
  </div>

  <LoadingSplash
    v-if="showSplash && (allowed || isDev) && isConfigured"
    @done="onSplashDone"
  />

  <!-- Festival Pass + Badge overlays. Gated to route.path === '/' inside the
       composable's overlayGate — they cannot paint on any other route. -->
  <FestivalPassScreen
    v-if="shouldShowPass"
    :address="userH160 ?? ''"
    :is-activating="isPassActivating"
    :is-exploding="isPassExploding"
    @activate="onActivatePass"
  />
  <ActivationModal
    variant="error"
    :visible="shouldShowPass && activationFailed"
    title="Activation failed"
    message="Something went wrong activating your pass. Try again, or do it later — some features will ask you to activate when you use them."
    primary-label="Try again"
    secondary-label="Do it later"
    :busy="isPassActivating"
    @primary="onRetryActivation"
    @secondary="onDeferPass"
  />
  <BadgeEarnedFestivalScreen
    v-if="shouldShowBadge"
    :address="userH160 ?? ''"
    :festival-name="festivalMetadata?.name || 'Web3 Summit'"
    :received-at-ms="activatedAtMs ?? undefined"
    @next="onBadgeNext"
  />
</template>
