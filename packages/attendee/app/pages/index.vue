<script setup lang="ts">
import { computed } from "vue";
import { useFestival } from "~/composables/useFestival";
import { useNow } from "~/composables/useNow";
import { useRegistration } from "~/composables/useRegistration";
import { useSchedule } from "~/composables/useSchedule";
import { useSubEvents, type AttendeeSubEvent } from "~/composables/useSubEvents";
import { useSessionLimit } from "~/composables/useSessionLimit";
import { usePoaps } from "~/composables/usePoaps";
import { useFestivalPass } from "~/composables/useFestivalPass";
import { usePassGate } from "~/composables/usePassGate";
import { useOnboardingSeen } from "~/composables/useOnboardingSeen";
import {
  useProgramTimeline,
  isItemOngoing,
  isItemPast,
  getItemId,
  getItemCategory,
  CATEGORY_STYLE,
} from "~/composables/useProgramTimeline";
import type { TimelineItem } from "~/composables/useProgramTimeline";
import { useWalletStore } from "@festival/shared/host/wallet";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import {
  LOCATION_LABEL_MAX_CHARS,
  resolveShortLocationLabel,
} from "@festival/shared/venue/floors";
import { useVenueMap } from "~/composables/useVenueMap";
import { ss58ToH160, isValidEvmAddress } from "@festival/shared/utils/address";
import { formatTimeBerlin, MS_PER_MINUTE } from "@festival/shared/utils/time";
import { truncate } from "@festival/shared/utils/text";

const { metadata: festivalMetadata } = useFestival();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { entries: scheduleEntries } = useSchedule();
const { subEvents } = useSubEvents();
const { collectibleSubEventPoaps } = usePoaps();
const { passStatus } = useFestivalPass();
const passGate = usePassGate("use all Web3 Summit features");

function onActivatePass() {
  passGate.run(() => {});
}
const { has: hasSeenOnboarding } = useOnboardingSeen();
const buildScheduleTo = computed(() =>
  hasSeenOnboarding("build-schedule") ? "/program" : "/program/welcome",
);
const collectBadgesTo = computed(() =>
  hasSeenOnboarding("receive-badge") ? "/program" : "/my/badges/welcome",
);
const hostSessionTo = computed(() =>
  hasSeenOnboarding("host-session") ? "/sessions/create" : "/sessions/host",
);

// Shared content for the Host / Build / Collect feature cards, rendered both
// locked (pre-check-in) and unlocked (as links). See <HomeFeatureCard>.
const HOST_FEATURE = {
  bg: "bg-magenta",
  accent: "#C600AA",
  image: "/host-schedule-img.svg",
  imageClass: "absolute -bottom-1 right-[-10px] h-[140px]",
  title: "Host your own session",
  subtitle: "You can host two sessions",
};
const BUILD_FEATURE = {
  bg: "bg-olive",
  accent: "#728806",
  image: "/build-schedule-img.svg",
  imageClass: "absolute -bottom-1 right-0 h-[130px]",
  title: "Build your schedule",
  subtitle: "Save sessions from the Program",
};
const COLLECT_FEATURE = {
  bg: "bg-community",
  accent: "#9462FA",
  image: "/collect.svg",
  imageClass: "absolute bottom-[1px] right-[-7px] h-[135px]",
  title: "Collect more badges",
  subtitle: "Earn badges by attending community sessions.",
};
const { myList } = useProgramTimeline();
const wallet = useWalletStore();

// ── Reactive clock (shared singleton). Drives EventReminder + My List ──
const nowDate = useNow();
const now = computed(() => nowDate.value.getTime());

const { markers: venueMarkers, zones: venueZones } = useVenueMap();

// ── Section 4: Host your own session / My session card ──

const userH160 = computed(() => {
  if (!wallet.isConnected) return null;
  return isValidEvmAddress(wallet.address)
    ? wallet.address.toLowerCase()
    : ss58ToH160(wallet.address).toLowerCase();
});

const mySessions = computed<AttendeeSubEvent[]>(() => {
  if (!userH160.value) return [];
  const nowSec = now.value / 1000;
  return subEvents.value
    .filter(
      (se) =>
        se.creator.toLowerCase() === userH160.value && se.endTime > nowSec,
    )
    .sort((a, b) => a.startTime - b.startTime);
});

const { canHostMore: canHostMoreSessions } = useSessionLimit();

function isSessionOngoing(session: AttendeeSubEvent): boolean {
  const t = Date.now();
  return session.startTime * 1000 <= t && session.endTime * 1000 > t;
}

function getSessionSubtitle(session: AttendeeSubEvent): string {
  const joiners = `${session.registeredCount} Joiner${session.registeredCount !== 1 ? "s" : ""}`;
  if (isSessionOngoing(session)) return `Session ongoing · ${joiners}`;
  const diff = session.startTime * 1000 - Date.now();
  if (diff <= 0) return joiners;
  const totalMin = Math.floor(diff / MS_PER_MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  let countdown = "";
  if (h > 0 && m > 0) countdown = `Start within ${h}h ${m} min`;
  else if (h > 0) countdown = `Start within ${h}h`;
  else countdown = `Start within ${m} min`;
  return `${countdown} · ${joiners}`;
}

// ── My List (bookmarked + registered sessions) ──

const myListItems = computed(() =>
  myList.value.filter((item) => !isItemPast(item)).slice(0, 3),
);

function getMyListAccentColor(item: TimelineItem): string {
  const category = getItemCategory(item);
  // Official entries dim when they're not ongoing; the colored ones keep their color.
  if (category === "official")
    return isItemOngoing(item) ? "#fafaf9" : "#57534e";
  return CATEGORY_STYLE[category].color;
}

function getMyListTitle(item: TimelineItem): string {
  return item.type === "official"
    ? item.entry.title
    : item.subEvent.metadata.name;
}

function getMyListTimeLabel(item: TimelineItem): string {
  if (item.type === "official") {
    if (isItemOngoing(item))
      return `Started at ${formatTimeBerlin(item.entry.start)}`;
    return `${formatTimeBerlin(item.entry.start)} - ${formatTimeBerlin(item.entry.end)}`;
  }
  const s = new Date(item.subEvent.startTime * 1000);
  const e = new Date(item.subEvent.endTime * 1000);
  if (isItemOngoing(item)) return `Started at ${formatTimeBerlin(s)}`;
  return `${formatTimeBerlin(s)} - ${formatTimeBerlin(e)}`;
}

function getMyListLocation(item: TimelineItem): string {
  if (!venueMarkers.value.length) return "";
  let label = "";
  if (item.type === "official" && item.entry.venueMarkerId) {
    label = resolveShortLocationLabel(
      item.entry.venueMarkerId,
      venueMarkers.value,
      venueZones.value,
    );
  } else if (item.type === "community" && item.subEvent.metadata.location) {
    label = resolveShortLocationLabel(
      item.subEvent.metadata.location,
      venueMarkers.value,
      venueZones.value,
    );
  }
  return truncate(label, LOCATION_LABEL_MAX_CHARS);
}

function getMyListRoute(item: TimelineItem): string {
  return item.type === "official"
    ? `/program/${item.entry.id}`
    : `/sessions/${item.subEvent.address}`;
}

</script>

<template>
  <div class="space-y-5 pt-4 pb-4" data-testid="home-page">
    <!-- Title + notifications bell (checked-in only; announcements are a
         checked-in perk). The bell replaces the old in-feed AnnouncementBanner. -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold text-text-and-icons-primary" data-testid="home-heading">
        Home
      </h1>
      <HomeNotificationBell v-if="isCheckedIn" />
    </div>

    <!-- 1. Event Reminder -->
    <EventReminder
      :entries="scheduleEntries"
      :venue-markers="venueMarkers"
      :venue-zones="venueZones"
      :now="now"
      :festival-name="festivalMetadata?.name || 'Web3 Summit'"
    />

    <!-- 2. Passport. When the pass is deferred, a dark "Activate your pass"
         card sits behind the passport and peeks out at the bottom; both are
         bound by one rounded, clipped container. -->
    <div
      v-if="passStatus === 'deferred'"
      class="relative my-6 rounded-3xl overflow-hidden"
    >
      <button
        type="button"
        class="absolute inset-0 flex items-end bg-surface-2 text-activations"
        data-testid="activate-pass-cta"
        aria-label="Activate your pass"
        @click="onActivatePass"
      >
        <span class="flex w-full items-center justify-between px-5 h-14">
          <span class="text-lg font-semibold">Activate your pass</span>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>
      <HomePassport class="relative z-[1] mb-14" />
    </div>
    <HomePassport v-else class="my-6" />

    <!-- 2.5. Location (kept up top only when not yet checked in;
         once checked in it moves to the bottom of the page). -->
    <HomeLocation v-if="!isCheckedIn" />

    <!-- 3. Badge Collection -->
    <HomeBadgeCollection v-if="isCheckedIn" />

    <!-- Locked cards (not checked in): Host + Build dimmed with lock icon. -->
    <template v-if="!isCheckedIn">
      <h3
        class="text-base font-semibold text-text-and-icons-primary mt-8! mb-4"
        data-testid="check-in-to-unlock"
      >
        Check in to unlock
      </h3>

      <div class="space-y-6">
        <HomeFeatureCard v-bind="HOST_FEATURE" data-testid="locked-host-card" />
        <HomeFeatureCard v-bind="BUILD_FEATURE" data-testid="locked-build-card" />
        <HomeFeatureCard v-bind="COLLECT_FEATURE" data-testid="locked-collect-card" />
      </div>
    </template>

    <!-- 4. My Sessions -->
    <div v-if="isCheckedIn && mySessions.length">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold text-text-and-icons-primary">My Sessions</h3>
        <NuxtLink
          v-if="canHostMoreSessions"
          :to="hostSessionTo"
          class="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-text-and-icons-primary"
          aria-label="Host a session"
        >
          <PlusIcon :size="18" />
        </NuxtLink>
      </div>
      <div class="space-y-2">
        <NuxtLink
          v-for="session in mySessions"
          :key="session.address"
          :to="`/sessions/${session.address}`"
          class="block rounded-2xl bg-white px-4 py-2.5"
        >
          <div class="flex items-center gap-3">
            <div
              v-if="session.metadata.badgePixels"
              class="w-12 h-12 rounded-xl overflow-hidden shrink-0"
            >
              <BadgeCanvas :pixels="session.metadata.badgePixels" :size="48" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-black truncate">
                {{ session.metadata.name }}
              </p>
              <p class="text-xs text-black/50 mt-0.5">{{ getSessionSubtitle(session) }}</p>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- 5. My List -->
    <div v-if="isCheckedIn && myListItems.length">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold text-text-and-icons-primary">My List</h3>
        <NuxtLink
          to="/program?tab=mylist"
          class="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-text-and-icons-primary"
        >
          <ArrowRightIcon />
        </NuxtLink>
      </div>
      <div
        class="rounded-2xl bg-surface-2 divide-y divide-white/8 overflow-hidden"
      >
        <NuxtLink
          v-for="item in myListItems"
          :key="getItemId(item)"
          :to="getMyListRoute(item)"
          class="flex items-start gap-2.5 p-3 block"
        >
          <div
            class="w-[3px] shrink-0 self-stretch rounded-full my-0.5"
            :style="{ backgroundColor: getMyListAccentColor(item) }"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span
                v-if="isItemOngoing(item)"
                class="w-1.5 h-1.5 rounded-full bg-danger shrink-0"
              />
              <p class="text-sm font-medium text-text-and-icons-primary line-clamp-1">
                {{ getMyListTitle(item) }}
              </p>
            </div>
            <div class="flex items-start justify-between gap-2 mt-0.5">
              <span class="text-xs text-text-muted whitespace-nowrap shrink-0">{{
                getMyListTimeLabel(item)
              }}</span>
              <span class="text-xs text-text-muted text-left">{{
                getMyListLocation(item)
              }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <template v-if="isCheckedIn">

      <div class="space-y-6">
        <!-- Host your own session (fallback when user has no sessions) -->
        <HomeFeatureCard
          v-if="!mySessions.length && canHostMoreSessions"
          v-bind="HOST_FEATURE"
          :to="hostSessionTo"
        />
        <!-- 6. Build your schedule (only when no saved items) -->
        <HomeFeatureCard
          v-if="!myListItems.length"
          v-bind="BUILD_FEATURE"
          :to="buildScheduleTo"
        />
        <!-- 7. Collect more badges (only when user has no session badges yet) -->
        <HomeFeatureCard
          v-if="collectibleSubEventPoaps.length === 0"
          v-bind="COLLECT_FEATURE"
          :to="collectBadgesTo"
          data-testid="collect-badges-card"
        />
      </div>
      <!-- 8. Festival chat -->
      <HomeFestivalChat />
      <!-- 9. Location (moves to bottom once the user is checked in) -->
      <HomeLocation />
    </template>
  </div>

  <ActivationModal
    :visible="passGate.state.value !== 'none'"
    v-bind="passGate.modalProps.value"
    @primary="passGate.onPrimary"
    @secondary="passGate.onSecondary"
  />
</template>
