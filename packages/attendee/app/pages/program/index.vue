<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from "vue";
import {
  useProgramTimeline,
  getItemId,
  isItemOngoing,
} from "~/composables/useProgramTimeline";
import { useBookmarks } from "~/composables/useBookmarks";
import { useFestival } from "~/composables/useFestival";
import { useNow } from "~/composables/useNow";
import { useRegistration } from "~/composables/useRegistration";
import { useSavedItems } from "~/composables/useSavedItems";
import { useOnboardingSeen } from "~/composables/useOnboardingSeen";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { useVenueMap } from "~/composables/useVenueMap";
import { toBerlinDateKey, berlinHourOf } from "@festival/shared/utils/time";
import type {
  TimelineDay,
  TimelineItem,
} from "~/composables/useProgramTimeline";
import { useAppScroller } from "~/composables/appScroller";

const { days, myListDays } = useProgramTimeline();
const { toggleBookmark, isBookmarked } = useBookmarks();
const { metadata } = useFestival();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { savedItems } = useSavedItems();
const myListCount = computed(() => savedItems.value.length);
const { has: hasSeenOnboarding } = useOnboardingSeen();
const hostSessionTo = computed(() =>
  hasSeenOnboarding("host-session") ? "/sessions/create" : "/sessions/host",
);

// `displayedCount` lags the real count on increments so the number ticks up
// exactly when the flying-ghost lands; decrements apply immediately. The
// fallback timeout covers paths with no flight (detail-page toggles).
const counterPulse = ref(false);
const displayedCount = ref(myListCount.value);
let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
const FALLBACK_CATCHUP_MS = 1000;
const PULSE_DURATION_MS = 800;

watch(myListCount, (n, prev) => {
  if (n <= prev) {
    // Un-star: update immediately, cancel any pending catch-up.
    if (catchUpTimer) {
      clearTimeout(catchUpTimer);
      catchUpTimer = null;
    }
    displayedCount.value = n;
    return;
  }
  // Increment: wait for `mylist:landed` to bump the display. Fallback timer
  // covers the no-flight paths (detail-page bookmark, reduced-motion users).
  if (catchUpTimer) clearTimeout(catchUpTimer);
  catchUpTimer = setTimeout(() => {
    displayedCount.value = myListCount.value;
    catchUpTimer = null;
  }, FALLBACK_CATCHUP_MS);
});

function onMyListLanded() {
  if (catchUpTimer) {
    clearTimeout(catchUpTimer);
    catchUpTimer = null;
  }
  displayedCount.value = myListCount.value;
  // Restart the pulse from scratch on each land so back-to-back arrivals each
  // get their own beat (rapid star-tapping or future "Add all" flow).
  if (pulseTimer) clearTimeout(pulseTimer);
  counterPulse.value = true;
  pulseTimer = setTimeout(() => {
    counterPulse.value = false;
    pulseTimer = null;
  }, PULSE_DURATION_MS);
}
const scroller = useAppScroller();
const nowDate = useNow();
const nowMs = computed(() => nowDate.value.getTime());

function isFirstSlot(day: TimelineDay, slot: TimelineDay["hourSlots"][number]): boolean {
  return day.hourSlots[0] === slot;
}

function firstOngoingPosition(day: TimelineDay): { hour: number; idx: number } | null {
  for (const slot of day.hourSlots) {
    for (let i = 0; i < slot.items.length; i++) {
      if (isItemOngoing(slot.items[i]!, nowMs.value)) return { hour: slot.hour, idx: i };
    }
  }
  return null;
}

function isNowAnchor(day: TimelineDay, slot: TimelineDay["hourSlots"][number], idx: number): boolean {
  const pos = firstOngoingPosition(day);
  return pos !== null && pos.hour === slot.hour && pos.idx === idx;
}

const route = useRoute();
const activeTab = ref<"program" | "mylist">(
  route.query.tab === "mylist" && isCheckedIn.value ? "mylist" : "program",
);

// If the user gets unchecked-in (or the flag flips after mount), bounce them
// off the My List tab so they can't sit on a hidden tab.
watch(isCheckedIn, (checkedIn) => {
  if (!checkedIn && activeTab.value === "mylist") activeTab.value = "program";
});
const showScrollTop = ref(false);
const isScrolled = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);
const headerHeight = ref(0);
const dayHeaderHeight = ref(0);
const legendHeight = ref(0);

const dayHeaderStickyTop = computed(() => `${headerHeight.value}px`);
const legendStickyTop = computed(
  () => `${headerHeight.value + dayHeaderHeight.value}px`,
);

const stuckDays = ref<Set<string>>(new Set());
const dayHeaderEls = ref<HTMLElement[]>([]);
const legendEls = ref<HTMLElement[]>([]);
let stickyObserver: IntersectionObserver | null = null;

const activeDays = computed<TimelineDay[]>(() =>
  activeTab.value === "program" ? days.value : myListDays.value,
);

const { markers: venueMarkers, zones: venueZones } = useVenueMap();

function onScroll() {
  const y = scroller.value?.scrollTop ?? 0;
  showScrollTop.value = y > 200;
  isScrolled.value = y > 50;
}

function scrollToTop() {
  scroller.value?.scrollTo({ top: 0, behavior: "smooth" });
}

onMounted(() => {
  if (headerEl.value) {
    headerHeight.value = headerEl.value.offsetHeight;
  }
  scroller.value?.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("mylist:landed", onMyListLanded);
});

onUnmounted(() => {
  scroller.value?.removeEventListener("scroll", onScroll);
  window.removeEventListener("mylist:landed", onMyListLanded);
  stickyObserver?.disconnect();
  stickyObserver = null;
  if (catchUpTimer) {
    clearTimeout(catchUpTimer);
    catchUpTimer = null;
  }
  if (pulseTimer) {
    clearTimeout(pulseTimer);
    pulseTimer = null;
  }
});

watch(
  [activeDays, headerHeight],
  () => {
    dayHeaderEls.value = [];
    legendEls.value = [];
    stuckDays.value = new Set();
    void nextTick(() => {
      measureStickyHeights();
      attachStickyObserver();
    });
  },
  { immediate: true },
);

function measureStickyHeights() {
  const dayHeader = dayHeaderEls.value[0];
  if (dayHeader) dayHeaderHeight.value = dayHeader.offsetHeight;
  const legend = legendEls.value[0];
  if (legend) legendHeight.value = legend.offsetHeight;
}

function attachStickyObserver() {
  stickyObserver?.disconnect();
  const root = scroller.value;
  if (!root || !dayHeaderEls.value.length) return;
  stickyObserver = new IntersectionObserver(
    (entries) => {
      const next = new Set(stuckDays.value);
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.dateKey;
        if (!key) continue;
        if (entry.intersectionRatio < 1) next.add(key);
        else next.delete(key);
      }
      stuckDays.value = next;
    },
    {
      root,
      rootMargin: `-${headerHeight.value + 1}px 0px 0px 0px`,
      threshold: [1],
    },
  );
  for (const el of dayHeaderEls.value) {
    if (el) stickyObserver.observe(el);
  }
}

function switchTab(tab: "program" | "mylist") {
  activeTab.value = tab;
}

// ── Auto-scroll to "now" on first Program render ──
// Land on the current hour so the user sees what's happening right now. Fires
// once per mount; KeepAlive preserves scroll on revisit.
const hasAutoScrolledToNow = ref(false);

function autoScrollToNow() {
  if (hasAutoScrolledToNow.value) return;
  if (activeTab.value !== "program") return;
  if (!activeDays.value.length) return;

  const now = new Date();
  const todayKey = toBerlinDateKey(now);
  const targetDay = activeDays.value.find((d) => d.dateKey === todayKey);
  if (!targetDay) return; // today is outside the festival → leave at top

  const currentHour = berlinHourOf(now);
  const slot =
    targetDay.hourSlots.find((s) => s.hour === currentHour) ??
    targetDay.hourSlots.find((s) => s.hour > currentHour) ??
    targetDay.hourSlots[targetDay.hourSlots.length - 1];
  if (!slot) return;

  const el = document.querySelector<HTMLElement>(
    `[data-hour-slot="${todayKey}:${slot.hour}"]`,
  );
  if (!el) return;

  const scrollerEl = scroller.value;
  if (!scrollerEl) return;
  // getBoundingClientRect is viewport-relative; convert to scroller-content
  // coordinates by subtracting the scroller's own top and adding scrollTop.
  const top =
    el.getBoundingClientRect().top -
    scrollerEl.getBoundingClientRect().top +
    scrollerEl.scrollTop -
    headerHeight.value -
    dayHeaderHeight.value -
    legendHeight.value -
    8;
  scrollerEl.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  hasAutoScrolledToNow.value = true;
}

// Defer past Vue Router's default scrollBehavior, which scrolls to (0, 0) on
// new navigations and is scheduled via nextTick after the route resolves. A
// plain `await nextTick()` races with it; two rAFs land us safely after the
// next paint, so our scroll wins on tab-bar navigation (e.g. Home → Program).
function scheduleAutoScrollToNow() {
  if (typeof requestAnimationFrame === "undefined") {
    autoScrollToNow();
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => autoScrollToNow());
  });
}

watch(
  () => activeDays.value.length,
  (len) => {
    if (!len) return;
    scheduleAutoScrollToNow();
  },
  { immediate: true },
);

const subEventsEnabled = computed(() => metadata.value?.subEventsEnabled !== false);
</script>

<template>
  <div ref="scrollContainer" class="min-h-full -mx-4 px-4">
    <!-- Header: Program / My List toggle, sticky at top -->
    <div
      ref="headerEl"
      class="sticky top-0 z-20 bg-background -mx-4 px-4 pt-4 pb-3"
      data-testid="program-header"
    >
      <div class="flex items-baseline gap-4">
        <button
          class="text-2xl font-semibold transition-colors"
          :class="activeTab === 'program' ? 'text-white' : 'text-white/40'"
          data-testid="program-tab-program"
          @click="switchTab('program')"
        >
          Program
        </button>
        <button
          v-if="isCheckedIn"
          class="text-2xl font-semibold transition-colors flex items-center gap-2"
          :class="activeTab === 'mylist' ? 'text-white' : 'text-white/40'"
          data-testid="program-tab-mylist"
          @click="switchTab('mylist')"
        >
          My List
          <span
            class="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full text-xs font-semibold transition-[transform,background-color,color] duration-150"
            :class="[
              counterPulse || activeTab === 'mylist'
                ? 'bg-white text-black'
                : 'bg-surface-3 text-text-muted',
              counterPulse ? 'mylist-counter-pulse' : '',
            ]"
            data-testid="mylist-counter"
          >
            {{ displayedCount }}
          </span>
        </button>
      </div>
    </div>

    <!-- Continuous timeline: all days in sequence -->
    <div v-if="activeDays.length" class="pb-28">
      <div v-for="(day, dayIdx) in activeDays" :key="day.dateKey">
        <div
          :ref="(el) => { if (el) dayHeaderEls[dayIdx] = el as HTMLElement }"
          :data-date-key="day.dateKey"
          class="sticky z-10 -mx-4 px-4 py-3 flex items-center justify-between transition-colors"
          :class="[
            stuckDays.has(day.dateKey) ? 'bg-surface' : '',
            day.dayNumber !== 1 ? 'mt-6' : '',
          ]"
          :style="{ top: dayHeaderStickyTop }"
        >
          <span class="text-lg leading-[22px] font-semibold text-white"
            >Day {{ day.dayNumber }}</span
          >
          <span class="text-lg leading-[22px] font-semibold text-text-secondary">{{ day.label }}</span>
        </div>

        <div
          v-if="activeTab === 'program'"
          :ref="(el) => { if (el) legendEls[dayIdx] = el as HTMLElement }"
          class="sticky z-[9] -mx-4 px-4 py-2.5 flex items-center justify-between bg-background"
          :style="{ top: legendStickyTop }"
          data-testid="sessions-type-legend"
        >
          <span class="text-xs text-text-muted">Sessions Type</span>
          <div class="flex items-center gap-3 text-xs">
            <span class="flex items-center gap-1.5">
              <span class="w-[3px] h-3.5 rounded-full bg-official" />
              <span class="text-white">Official</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-[3px] h-3.5 rounded-full bg-community" />
              <span class="text-white">Community</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-[3px] h-3.5 rounded-full bg-activations" />
              <span class="text-white">Activations</span>
            </span>
          </div>
        </div>

        <!-- Program tab: hour-slotted timeline with left gutter -->
        <div v-if="activeTab === 'program'" class="pt-3">
          <div
            v-for="slot in day.hourSlots"
            :key="slot.hour"
            class="mb-2 space-y-2"
            :data-hour-slot="`${day.dateKey}:${slot.hour}`"
          >
            <div
              v-for="(item, idx) in slot.items"
              :key="getItemId(item)"
              class="flex gap-3"
            >
              <div class="w-12 shrink-0 pt-1.5">
                <span
                  v-if="isNowAnchor(day, slot, idx)"
                  class="block text-xs font-semibold text-danger"
                  data-testid="hour-slot-now"
                >Now</span>
                <template v-else-if="idx === 0">
                  <span
                    v-if="isFirstSlot(day, slot)"
                    class="block text-xs text-text-and-icons-secondary"
                  >Start at</span>
                  <span class="block text-xs text-text-and-icons-secondary">{{ slot.label }}</span>
                </template>
              </div>

              <div class="flex-1 min-w-0">
                <ProgramCard
                  :item="item"
                  :venue-markers="venueMarkers"
                  :venue-zones="venueZones"
                  :is-bookmarked="isBookmarked(getItemId(item))"
                  :now="nowMs"
                  @toggle-bookmark="toggleBookmark"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- My List tab: flat full-width cards, no gutter -->
        <div v-else class="pt-3 space-y-2">
          <template v-for="slot in day.hourSlots" :key="slot.hour">
            <ProgramCard
              v-for="item in slot.items"
              :key="getItemId(item)"
              :item="item"
              :venue-markers="venueMarkers"
              :venue-zones="venueZones"
              location-format="full"
              :is-bookmarked="isBookmarked(getItemId(item))"
              :now="nowMs"
              @toggle-bookmark="toggleBookmark"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- Empty states -->
    <div
      v-else-if="activeTab === 'mylist'"
      class="flex flex-col items-center justify-center min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-180px)]"
      data-testid="my-list-empty"
    >
      <img
        src="/empty-list.svg"
        alt=""
        class="w-[60%] max-w-[260px] h-auto mb-6"
        aria-hidden="true"
      />
      <p class="text-text-muted text-sm text-center max-w-[260px]">
        No sessions yet. Tap the star on any session to save it here
      </p>
    </div>

    <div v-else class="flex items-center justify-center py-20">
      <p class="text-text-muted text-sm">No sessions scheduled.</p>
    </div>

    <!-- Scroll-to-top button -->
    <Transition name="fade">
      <button
        v-if="showScrollTop"
        class="fixed bottom-[calc(var(--safe-bottom)+170px)] right-4 md:bottom-[calc(var(--safe-bottom)+90px)] md:right-[calc(var(--col-r)+1rem)] z-40 w-10 h-10 bg-surface-3 rounded-full flex items-center justify-center border border-white/12"
        @click="scrollToTop"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </Transition>

    <!-- Host your own session: collapsible button (Program tab only) -->
    <NuxtLink
      v-if="subEventsEnabled && isCheckedIn && activeTab === 'program'"
      :to="hostSessionTo"
      class="fixed right-4 md:right-[calc(var(--col-r)+1rem)] z-40 bg-white rounded-full h-14 flex items-center px-5 text-black shadow-lg overflow-hidden transition-all duration-300 ease-in-out md:max-w-[calc(var(--col-w)-2rem)] bottom-[calc(var(--safe-bottom)+75px)] md:bottom-[calc(var(--safe-bottom)+1rem)]"
      :style="{
        width: isScrolled ? '56px' : 'calc(100% - 32px)',
        padding: isScrolled ? '0' : undefined,
        justifyContent: isScrolled ? 'center' : 'space-between',
      }"
    >
      <span
        class="text-sm font-medium whitespace-nowrap transition-all duration-200"
        :class="isScrolled ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'"
      >
        Host your own session
      </span>
      <PlusIcon :size="22" :stroke-width="2" class="shrink-0 text-black" />
    </NuxtLink>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.mylist-counter-pulse {
  animation: mylist-counter-pulse 450ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes mylist-counter-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.5);
  }
  100% {
    transform: scale(1);
  }
}
</style>
