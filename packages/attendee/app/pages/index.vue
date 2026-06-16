<script setup lang="ts">
import { computed } from "vue";
import { useFestival } from "~/composables/useFestival";
import { useNow } from "~/composables/useNow";
import { useRegistration } from "~/composables/useRegistration";
import { useSchedule } from "~/composables/useSchedule";
import { useSubEvents } from "~/composables/useSubEvents";
import { usePoaps } from "~/composables/usePoaps";
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
import { resolveShortLocationLabel } from "@festival/shared/venue/floors";
import { useVenueMap } from "~/composables/useVenueMap";
import { ss58ToH160, isValidEvmAddress } from "@festival/shared/utils/address";
import { formatTimeBerlin } from "@festival/shared/utils/time";

const { metadata: festivalMetadata } = useFestival();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { entries: scheduleEntries } = useSchedule();
const { subEvents } = useSubEvents();
const { collectibleSubEventPoaps } = usePoaps();
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

const mySession = computed(() => {
  if (!userH160.value) return null;
  const nowSec = now.value / 1000;
  const mine = subEvents.value
    .filter(
      (se) =>
        se.creator.toLowerCase() === userH160.value && se.endTime > nowSec,
    )
    .sort((a, b) => a.startTime - b.startTime);
  return mine[0] || null;
});

const mySessionOngoing = computed(() => {
  if (!mySession.value) return false;
  const now = Date.now();
  return (
    mySession.value.startTime * 1000 <= now &&
    mySession.value.endTime * 1000 > now
  );
});

const mySessionSubtitle = computed(() => {
  if (!mySession.value) return "";
  const joiners = `${mySession.value.registeredCount} Joiner${mySession.value.registeredCount !== 1 ? "s" : ""}`;
  if (mySessionOngoing.value) return `Session ongoing · ${joiners}`;
  const diff = mySession.value.startTime * 1000 - Date.now();
  if (diff <= 0) return joiners;
  const totalMin = Math.floor(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  let countdown = "";
  if (h > 0 && m > 0) countdown = `Start within ${h}h ${m} min`;
  else if (h > 0) countdown = `Start within ${h}h`;
  else countdown = `Start within ${m} min`;
  return `${countdown} · ${joiners}`;
});

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
  if (item.type === "official" && item.entry.venueMarkerId) {
    return resolveShortLocationLabel(
      item.entry.venueMarkerId,
      venueMarkers.value,
      venueZones.value,
    );
  }
  if (item.type === "community" && item.subEvent.metadata.location) {
    return resolveShortLocationLabel(
      item.subEvent.metadata.location,
      venueMarkers.value,
      venueZones.value,
    );
  }
  return "";
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

    <!-- 2. Passport -->
    <HomePassport />

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
      <div
        class="block rounded-3xl bg-magenta relative overflow-hidden"
        data-testid="locked-host-card"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 8.5H17V6.5C17 3.74 14.76 1.5 12 1.5C9.24 1.5 7 3.74 7 6.5V8.5H6C4.9 8.5 4 9.4 4 10.5V20.5C4 21.6 4.9 22.5 6 22.5H18C19.1 22.5 20 21.6 20 20.5V10.5C20 9.4 19.1 8.5 18 8.5ZM12 17.5C10.9 17.5 10 16.6 10 15.5C10 14.4 10.9 13.5 12 13.5C13.1 13.5 14 14.4 14 15.5C14 16.6 13.1 17.5 12 17.5ZM9 8.5V6.5C9 4.84 10.34 3.5 12 3.5C13.66 3.5 15 4.84 15 6.5V8.5H9Z"
              fill="#C600AA"
            />
          </svg>
        </div>
        <img
          src="/host-schedule-img.svg"
          class="absolute -bottom-1 right-[-10px] h-[140px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Host your own session
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            You can host two sessions
          </p>
        </div>
        <div
          class="absolute inset-0 bg-black/45 z-20 pointer-events-none rounded-3xl"
        />
      </div>

      <div
        class="block rounded-3xl bg-olive relative overflow-hidden"
        data-testid="locked-build-card"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 8.5H17V6.5C17 3.74 14.76 1.5 12 1.5C9.24 1.5 7 3.74 7 6.5V8.5H6C4.9 8.5 4 9.4 4 10.5V20.5C4 21.6 4.9 22.5 6 22.5H18C19.1 22.5 20 21.6 20 20.5V10.5C20 9.4 19.1 8.5 18 8.5ZM12 17.5C10.9 17.5 10 16.6 10 15.5C10 14.4 10.9 13.5 12 13.5C13.1 13.5 14 14.4 14 15.5C14 16.6 13.1 17.5 12 17.5ZM9 8.5V6.5C9 4.84 10.34 3.5 12 3.5C13.66 3.5 15 4.84 15 6.5V8.5H9Z"
              fill="#728806"
            />
          </svg>
        </div>
        <img
          src="/build-schedule-img.svg"
          class="absolute -bottom-1 right-0 h-[130px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Build your schedule
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            Save sessions from the Program
          </p>
        </div>
        <div
          class="absolute inset-0 bg-black/45 z-20 pointer-events-none rounded-3xl"
        />
      </div>

      <div
        class="block rounded-3xl bg-community relative overflow-hidden"
        data-testid="locked-collect-card"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 8.5H17V6.5C17 3.74 14.76 1.5 12 1.5C9.24 1.5 7 3.74 7 6.5V8.5H6C4.9 8.5 4 9.4 4 10.5V20.5C4 21.6 4.9 22.5 6 22.5H18C19.1 22.5 20 21.6 20 20.5V10.5C20 9.4 19.1 8.5 18 8.5ZM12 17.5C10.9 17.5 10 16.6 10 15.5C10 14.4 10.9 13.5 12 13.5C13.1 13.5 14 14.4 14 15.5C14 16.6 13.1 17.5 12 17.5ZM9 8.5V6.5C9 4.84 10.34 3.5 12 3.5C13.66 3.5 15 4.84 15 6.5V8.5H9Z"
              fill="#9462FA"
            />
          </svg>
        </div>
        <img
          src="/collect.svg"
          class="absolute bottom-[1px] right-[-7px] h-[135px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Collect more badges
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            Earn badges by attending community sessions.
          </p>
        </div>
        <div
          class="absolute inset-0 bg-black/45 z-20 pointer-events-none rounded-3xl"
        />
      </div>
      </div>
    </template>

    <!-- 4. My List -->
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
            <div class="flex items-center justify-between mt-0.5">
              <span class="text-xs text-text-muted">{{
                getMyListTimeLabel(item)
              }}</span>
              <span class="text-xs text-text-muted">{{
                getMyListLocation(item)
              }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <template v-if="isCheckedIn">

      <div class="space-y-6">
      <!-- 5. Host your own session / My session -->
      <NuxtLink
        v-if="mySession"
        :to="`/sessions/${mySession.address}`"
        class="block rounded-2xl bg-white px-4 py-2.5"
      >
        <div class="flex items-center gap-3">
          <div
            v-if="mySession.metadata.badgePixels"
            class="w-12 h-12 rounded-xl overflow-hidden shrink-0"
          >
            <BadgeCanvas :pixels="mySession.metadata.badgePixels" :size="48" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-black truncate">
              {{ mySession.metadata.name }}
            </p>
            <p class="text-xs text-black/50 mt-0.5">{{ mySessionSubtitle }}</p>
          </div>
          <NuxtLink
            v-if="!mySessionOngoing"
            :to="`/my/manage/${mySession.address}/edit`"
            class="shrink-0"
            @click.stop
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 17.46v3.04c0 .28.22.5.5.5h3.04c.13 0 .26-.05.35-.15L17.81 9.94l-3.75-3.75L3.15 17.1a.49.49 0 0 0-.15.36Z"
                fill="black"
              />
              <path
                d="M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83a1 1 0 0 0 0-1.41Z"
                fill="black"
              />
            </svg>
          </NuxtLink>
        </div>
      </NuxtLink>

      <NuxtLink
        v-else
        :to="hostSessionTo"
        class="block rounded-3xl bg-magenta relative overflow-hidden"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#C600AA"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <img
          src="/host-schedule-img.svg"
          class="absolute -bottom-1 right-[-10px] h-[140px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Host your own session
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            You can host two sessions
          </p>
        </div>
      </NuxtLink>

      <!-- 6. Build your schedule (only when no saved items) -->
      <NuxtLink
        v-if="!myListItems.length"
        :to="buildScheduleTo"
        class="block rounded-3xl bg-olive relative overflow-hidden"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#728806"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <img
          src="/build-schedule-img.svg"
          class="absolute -bottom-1 right-0 h-[130px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Build your schedule
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            Save sessions from the Program
          </p>
        </div>
      </NuxtLink>

      <!-- 7. Collect more badges (only when user has no session badges yet) -->
      <NuxtLink
        v-if="collectibleSubEventPoaps.length === 0"
        :to="collectBadgesTo"
        class="block rounded-3xl bg-community relative overflow-hidden"
        data-testid="collect-badges-card"
      >
        <div
          class="absolute top-3 right-3 w-9 h-9 rounded-full bg-white flex items-center justify-center z-10"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9462FA"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <img
          src="/collect.svg"
          class="absolute bottom-[1px] right-[-7px] h-[135px]"
          alt=""
        />
        <div class="relative z-[1] p-3 pr-[50%]">
          <p class="text-2xl font-semibold text-text-and-icons-primary">
            Collect more badges
          </p>
          <p class="text-xs leading-[18px] text-text-and-icons-secondary mt-1 min-h-[2lh]">
            Earn badges by attending community sessions.
          </p>
        </div>
      </NuxtLink>

      </div>
      <!-- 8. Festival chat -->
      <HomeFestivalChat />
      <!-- 9. Location (moves to bottom once the user is checked in) -->
      <HomeLocation />
    </template>
  </div>
</template>
