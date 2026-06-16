<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSchedule } from "~/composables/useSchedule";
import { scheduleEntryCategory, CATEGORY_STYLE } from "~/composables/useProgramTimeline";
import { useBookmarks } from "~/composables/useBookmarks";
import { useFestival } from "~/composables/useFestival";
import { useRegistration } from "~/composables/useRegistration";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { resolveFullLocationLabel } from "@festival/shared/venue/floors";
import { useVenueMap } from "~/composables/useVenueMap";
import { useBulletinImage } from "~/composables/useBulletinImage";
import { formatTimeBerlin, formatDateBerlin, parseFestivalDate, isSameDay } from "@festival/shared/utils/time";

const route = useRoute();
const id = route.params.id as string;
const { entries } = useSchedule();
const { toggleBookmark, isBookmarked } = useBookmarks();
const { metadata, isLoading: festivalLoading } = useFestival();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);

const entry = computed(() => entries.value.find((e) => e.id === id));

const categoryStyle = computed(
  () => CATEGORY_STYLE[entry.value ? scheduleEntryCategory(entry.value) : "official"],
);

watch(
  [entry, festivalLoading],
  ([found, loading]) => {
    if (loading) return;
    if (!found) navigateTo("/", { replace: true });
  },
  { immediate: true },
);

const showToast = ref(false);
const locationViewOpen = ref(false);

const { markers: venueMarkers, zones: venueZones } = useVenueMap();

const bookmarked = computed(() => (entry.value ? isBookmarked(entry.value.id) : false));

const nowDate = useNow();
const ongoing = computed(() => {
  if (!entry.value) return false;
  const now = nowDate.value.getTime();
  const start = new Date(entry.value.start).getTime();
  const end = new Date(entry.value.end).getTime();
  return now >= start && now < end;
});
const ended = computed(() => {
  if (!entry.value) return false;
  return nowDate.value.getTime() >= new Date(entry.value.end).getTime();
});

const speakerLabel = computed(() => entry.value?.speakers.join(", ") ?? "");

const timeRange = computed(() => {
  if (!entry.value) return "";
  const start = parseFestivalDate(entry.value.start);
  const end = parseFestivalDate(entry.value.end);
  return `${formatTime(start)} - ${formatTime(end)}`;
});

const dayLabel = computed(() => {
  if (!entry.value) return "";
  const start = parseFestivalDate(entry.value.start);
  if (isSameDay(start, nowDate.value)) return "";
  return formatDay(start);
});

const locationLabel = computed(() => {
  if (!entry.value?.venueMarkerId) return "";
  return resolveFullLocationLabel(
    entry.value.venueMarkerId,
    venueMarkers.value,
    venueZones.value,
  );
});

// Resolves through the host preimage manager, so it stays a blob URL in the host.
const imageUrl = useBulletinImage(
  () => metadata.value?.festivalPoapImage || metadata.value?.image || null,
);

function formatTime(d: Date): string {
  return formatTimeBerlin(d);
}

function formatDay(d: Date): string {
  return formatDateBerlin(d, { weekday: "long", month: "long", day: "numeric" });
}

function handleToggle() {
  if (!entry.value) return;
  const wasBookmarked = isBookmarked(entry.value.id);
  toggleBookmark(entry.value.id, {
    startMs: parseFestivalDate(entry.value.start).getTime(),
    title: entry.value.title,
    deeplink: `/#/program/${entry.value.id}`,
    location: locationLabel.value || undefined,
  });
  if (!wasBookmarked) {
    showToast.value = true;
  }
}
</script>

<template>
  <SessionDetailLayout
    v-if="entry"
    :image-url="imageUrl"
    :banner-value="speakerLabel"
    banner-label="Speaker"
    :category="categoryStyle.label"
    :category-color="categoryStyle.color"
    :title="entry.title"
    :description="entry.description"
    :day-label="dayLabel"
    :time-range="timeRange"
    :location-label="locationLabel"
    :location="entry.venueMarkerId ?? null"
    :venue-markers="venueMarkers"
    :venue-zones="venueZones"
    :bookmarked="isCheckedIn ? bookmarked : null"
    :ongoing="ongoing"
    :ended="ended"
    @toggle-bookmark="handleToggle"
    @open-location="locationViewOpen = true"
  />

  <SessionLocationView
    v-if="locationViewOpen && entry?.venueMarkerId"
    :location="entry.venueMarkerId"
    :detail-path="`/program/${entry.id}`"
    :markers="venueMarkers"
    :zones="venueZones"
    @close="locationViewOpen = false"
  />

  <div
    class="fixed left-4 right-4 md:left-[calc(var(--col-l)+1rem)] md:right-[calc(var(--col-r)+1rem)] z-[1000] pointer-events-none"
    style="bottom: calc(var(--safe-bottom) + 1.5rem)"
  >
    <SuccessToast :visible="showToast" @hide="showToast = false" />
  </div>
</template>
