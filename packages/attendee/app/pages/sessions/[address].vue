<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSubEvents } from "~/composables/useSubEvents";
import { useSubEventRoles } from "~/composables/useSubEventRoles";
import { useRegistration } from "~/composables/useRegistration";
import { useFestival } from "~/composables/useFestival";
import { useFlagSession } from "~/composables/useFlagSession";
import { useHiddenSessions } from "~/composables/useHiddenSessions";
import { useBookmarks } from "~/composables/useBookmarks";
import { useNow } from "~/composables/useNow";
import { useSessionWatcher } from "~/composables/useSessionWatcher";
import { hasDeployedContracts } from "@festival/shared/contracts/festival-reads";
import { useWalletStore } from "@festival/shared/host/wallet";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { MOCK_VENUE_MAP } from "@festival/shared/mocks";
import { DEFAULT_ZONES } from "@festival/shared/venue/zones";
import { resolveLocationLabel } from "@festival/shared/venue/floors";
import { useBulletinImage } from "~/composables/useBulletinImage";
import {
  SESSION_CHECKIN_GRACE_MS,
  formatCountdown,
  isSameDay,
  formatTimeBerlin,
  formatDateBerlin,
} from "@festival/shared/utils/time";
import {
  ss58ToH160,
  isValidEvmAddress,
} from "@festival/shared/utils/address";

definePageMeta({
  validate: (route) => isValidEvmAddress(route.params.address as string),
});

const route = useRoute();
const addr = route.params.address as string;
// `?from=create` tells us the user landed here from the create-flow success
// screen. Browser history points back into the create page, which would be
// confusing. Send them to /program instead.
const backTo = computed(() =>
  route.query.from === "create" ? "/program" : undefined,
);
const wallet = useWalletStore();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { subEvents, isLoading: subEventsLoading, reload: reloadSubEvents } =
  useSubEvents();

watch(
  [subEvents, subEventsLoading],
  ([list, loading]) => {
    if (loading) return;
    if (!list.find((se) => se.address === addr)) {
      navigateTo("/", { replace: true });
    }
  },
  { immediate: true },
);
const { metadata: festivalMetadata } = useFestival();
const subEvent = computed(() =>
  subEvents.value.find((se) => se.address === addr),
);
const { roles: subEventRoles } = useSubEventRoles(addr);
const hasManageAccess = computed(() => subEventRoles.value.length > 0);
const now = useNow();
const { isBookmarked, toggleBookmark } = useBookmarks();

const reportSheetVisible = ref(false);
const {
  txStatus: flagTxStatus,
  error: flagError,
  flag: submitFlag,
  reset: resetFlag,
  userFestivalPoapTokenId,
} = useFlagSession();
const { isHidden } = useHiddenSessions();

const passportOpen = ref(false);
const badgeEarnedOpen = ref(false);
const locationViewOpen = ref(false);
// "Received: 18 June, 12:03" line on the badge-earned screen. Stamped at the
// moment the CheckedIn event lands; the precise on-chain timestamp is not
// available client-side without an extra read.
const receivedAt = ref<Date | null>(null);
// Always-on while page mounted: catches CheckedIn for the badge-earned
// animation AND live-applies session metadata updates to useSubEvents.
const { checkedIn: watcherCheckedIn } = useSessionWatcher(addr);

watch(watcherCheckedIn, (caught) => {
  if (!caught) return;
  receivedAt.value = new Date();
  passportOpen.value = false;
  // Creators auto-check-in at session creation and don't earn a "badge" in the
  // collectible sense. Skip the celebration animation for them.
  if (!isCreator.value) {
    badgeEarnedOpen.value = true;
  }
  // Reconcile cache in the background. Animation is event-driven.
  reloadSubEvents().catch(() => {});
});

function handleToggleBookmark() {
  if (!subEvent.value) return;
  toggleBookmark(addr, {
    startMs: subEvent.value.startTime * 1000,
    title: subEvent.value.metadata.name,
    deeplink: `/#/sessions/${addr}`,
    location: locationLabel.value || undefined,
  });
}

function openPassport() {
  passportOpen.value = true;
}

function closePassport() {
  passportOpen.value = false;
}

function dismissBadgeEarned() {
  badgeEarnedOpen.value = false;
}

const venueMarkers = computed(() => {
  if (
    hasDeployedContracts() &&
    festivalMetadata.value?.venueMap?.markers?.length
  ) {
    return festivalMetadata.value.venueMap.markers;
  }
  return MOCK_VENUE_MAP.markers;
});

const venueZones = computed(() => {
  if (
    hasDeployedContracts() &&
    festivalMetadata.value?.venueMap?.zones?.length
  ) {
    return festivalMetadata.value.venueMap.zones;
  }
  return DEFAULT_ZONES;
});

const speakerLabel = computed(() => {
  const speakers = subEvent.value?.metadata.speakers ?? [];
  return speakers.length ? speakers.join(", ") : "";
});

const timeRange = computed(() => {
  if (!subEvent.value) return "";
  const start = new Date(subEvent.value.startTime * 1000);
  const end = new Date(subEvent.value.endTime * 1000);
  return `${formatTime(start)} - ${formatTime(end)}`;
});

const dayLabel = computed(() => {
  if (!subEvent.value) return "";
  const start = new Date(subEvent.value.startTime * 1000);
  if (isSameDay(start, now.value)) return "";
  return formatDay(start);
});

const locationLabel = computed(() => {
  if (!subEvent.value?.metadata.location) return "";
  return resolveLocationLabel(
    subEvent.value.metadata.location,
    venueMarkers.value,
  );
});

// Resolves through the host preimage manager, so it stays a blob URL in the host.
const festivalPoapImageUrl = useBulletinImage(
  () => festivalMetadata.value?.festivalPoapImage || festivalMetadata.value?.image || null,
);

const isCreator = computed(() => {
  if (!subEvent.value || !wallet.isConnected) return false;
  const userH160 = isValidEvmAddress(wallet.address)
    ? wallet.address.toLowerCase()
    : ss58ToH160(wallet.address).toLowerCase();
  return subEvent.value.creator.toLowerCase() === userH160;
});

const canReport = computed(() => {
  if (!subEvent.value) return false;
  if (isCreator.value) return false;
  if (isHidden(addr)) return false;
  return userFestivalPoapTokenId() !== null;
});

// ── State machine for the action CTA ──

const sessionStartMs = computed(() =>
  subEvent.value ? subEvent.value.startTime * 1000 : 0,
);
const sessionEndMs = computed(() =>
  subEvent.value ? subEvent.value.endTime * 1000 : 0,
);
const collectDeadlineMs = computed(
  () => sessionEndMs.value + SESSION_CHECKIN_GRACE_MS,
);
const nowMs = computed(() => now.value.getTime());

const isUpcoming = computed(() => nowMs.value < sessionStartMs.value);
const isLive = computed(
  () =>
    nowMs.value >= sessionStartMs.value &&
    nowMs.value <= collectDeadlineMs.value,
);
const hasEnded = computed(() => nowMs.value > collectDeadlineMs.value);
const isPastEnd = computed(() => nowMs.value >= sessionEndMs.value);

const countdownLabel = computed(() =>
  formatCountdown(sessionStartMs.value - nowMs.value),
);

const receivedLabel = computed(() =>
  receivedAt.value ? formatReceived(receivedAt.value) : "",
);

function formatReceived(d: Date): string {
  const day = formatDateBerlin(d, { day: "numeric", month: "long" });
  const time = formatTimeBerlin(d);
  return `${day}, ${time}`;
}

function openReportSheet() {
  resetFlag();
  reportSheetVisible.value = true;
}

async function confirmReport() {
  const ok = await submitFlag(addr);
  if (!ok) return;
  // Stay on the sheet to show the success state; user dismisses with "Done".
}

function dismissReportSheet() {
  reportSheetVisible.value = false;
  resetFlag();
}

function handleReportDone() {
  reportSheetVisible.value = false;
  resetFlag();
  navigateTo("/program", { replace: true });
}

function formatTime(d: Date): string {
  return formatTimeBerlin(d);
}

function formatDay(d: Date): string {
  return formatDateBerlin(d, { weekday: "long", month: "long", day: "numeric" });
}

</script>

<template>
  <SessionDetailLayout
    v-if="subEvent"
    :badge-pixels="subEvent.metadata.badgePixels ?? null"
    :image-url="festivalPoapImageUrl"
    :banner-value="speakerLabel"
    :banner-label="speakerLabel ? 'Session Speaker' : undefined"
    category="Community"
    category-color="var(--color-community)"
    :title="subEvent.metadata.name"
    :description="subEvent.metadata.description"
    :day-label="dayLabel"
    :time-range="timeRange"
    :location-label="locationLabel"
    :location="subEvent.metadata.location ?? null"
    :venue-markers="venueMarkers"
    :venue-zones="venueZones"
    :bookmarked="isCreator ? null : isBookmarked(addr)"
    :ended="isPastEnd"
    :back-to="backTo"
    @toggle-bookmark="handleToggleBookmark"
    @open-location="locationViewOpen = true"
  >
    <template v-if="isCreator && !isPastEnd" #topBarTrailing>
      <NuxtLink
        :to="`/my/manage/${addr}/edit`"
        class="w-10 h-10 flex items-center justify-center"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 17.46v3.04c0 .28.22.5.5.5h3.04c.13 0 .26-.05.35-.15L17.81 9.94l-3.75-3.75L3.15 17.1a.49.49 0 0 0-.15.36Z" fill="white"/><path d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83a1 1 0 0 0 0-1.41Z" fill="white"/></svg>
      </NuxtLink>
    </template>

    <template v-if="canReport" #secondaryAction>
      <button
        class="block w-full py-4 rounded-2xl bg-danger/10 text-danger text-base font-semibold"
        data-testid="session-report-trigger"
        @click="openReportSheet"
      >
        Report
      </button>
    </template>

    <template #action>
      <NuxtLink
        v-if="isCreator || hasManageAccess"
        :to="`/my/manage/${addr}/check-in`"
        class="block w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold text-center"
      >
        Check People In
      </NuxtLink>

      <template v-else-if="!subEvent.isCheckedIn">
        <button
          v-if="isUpcoming"
          class="w-full flex items-center justify-center rounded-2xl py-4 text-sm font-medium bg-white/10 text-white/60 cursor-default"
          disabled
          data-testid="session-collect-badge-pending"
        >
          Visit & Collect Badge in {{ countdownLabel }}
        </button>

        <button
          v-else-if="isLive && isCheckedIn"
          class="w-full flex items-center justify-center rounded-2xl py-4 text-sm font-semibold bg-white text-black"
          data-testid="session-collect-badge-cta"
          @click="openPassport"
        >
          Collect Badge
        </button>
      </template>
    </template>
  </SessionDetailLayout>

  <ReportSessionSheet
    :visible="reportSheetVisible"
    :tx-status="flagTxStatus"
    :error="flagError"
    @confirm="confirmReport"
    @cancel="dismissReportSheet"
    @done="handleReportDone"
  />

  <PassportOverlay v-if="passportOpen" :force-show-qr="true" @close="closePassport" />

  <BadgeEarnedScreen
    v-if="badgeEarnedOpen && subEvent"
    :badge-pixels="subEvent.metadata.badgePixels ?? null"
    :session-name="subEvent.metadata.name"
    :received-label="receivedLabel"
    @dismiss="dismissBadgeEarned"
  />

  <SessionLocationView
    v-if="locationViewOpen && subEvent?.metadata.location"
    :location="subEvent.metadata.location"
    :session-address="addr"
    :markers="venueMarkers"
    :zones="venueZones"
    @close="locationViewOpen = false"
  />
</template>
