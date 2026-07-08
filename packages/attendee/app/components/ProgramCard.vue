<script setup lang="ts">
import type { TimelineItem } from "~/composables/useProgramTimeline";
import {
  isItemOngoing,
  isItemPast,
  getItemId,
  getItemCategory,
  CATEGORY_STYLE,
} from "~/composables/useProgramTimeline";
import { ss58ToH160, isValidEvmAddress } from "@festival/shared/utils/address";
import {
  LOCATION_LABEL_MAX_CHARS,
  resolveFullLocationLabel,
  resolveShortLocationLabel,
} from "@festival/shared/venue/floors";
import { useWalletStore } from "@festival/shared/host/wallet";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { useRegistration } from "~/composables/useRegistration";
import type { VenueMarker, VenueZone } from "@festival/shared/metadata/schemas";
import type { BookmarkPayload } from "~/composables/useBookmarks";
import { useMyListFlyAnimation } from "~/composables/useMyListFlyAnimation";
import { formatTimeBerlin, parseFestivalDate } from "@festival/shared/utils/time";
import { truncate } from "@festival/shared/utils/text";

const props = withDefaults(
  defineProps<{
    item: TimelineItem;
    venueMarkers?: VenueMarker[];
    venueZones?: VenueZone[];
    isBookmarked?: boolean;
    now?: number;
    // `short` = "Floor · Zone" for quick scan (Program tab).
    // `full`  = "Floor · Zone · Marker" for precise navigation (My List tab).
    locationFormat?: "short" | "full";
  }>(),
  { locationFormat: "short" },
);

const emit = defineEmits<{
  toggleBookmark: [id: string, payload: BookmarkPayload];
}>();

const wallet = useWalletStore();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);

const ongoing = computed(() => isItemOngoing(props.item, props.now));
const past = computed(() => isItemPast(props.item, props.now));
const itemId = computed(() => getItemId(props.item));

const isOwner = computed(() => {
  if (props.item.type !== "community" || !wallet.isConnected) return false;
  const userH160 = isValidEvmAddress(wallet.address)
    ? wallet.address.toLowerCase()
    : ss58ToH160(wallet.address).toLowerCase();
  return props.item.subEvent.creator.toLowerCase() === userH160;
});

const accentColor = computed(() => {
  if (past.value) return "#44403c"; // stone-700
  return CATEGORY_STYLE[getItemCategory(props.item)].color;
});

const cardClass = computed(() => {
  if (past.value) return "bg-transparent border-white/10";
  if (isOwner.value) return "bg-white border-white/0";
  return "bg-surface-2 border-black hover:bg-surface-3";
});

const title = computed(() =>
  props.item.type === "official"
    ? props.item.entry.title
    : props.item.subEvent.metadata.name,
);

const SPEAKERS_MAX_CHARS = 64;
const subtitle = computed(() => {
  const speakers =
    props.item.type === "official"
      ? props.item.entry.speakers.join(", ")
      : props.item.subEvent.metadata.speakers.join(", ");
  return truncate(speakers, SPEAKERS_MAX_CHARS);
});

const timeRange = computed(() => {
  if (props.item.type === "official") {
    const start = parseFestivalDate(props.item.entry.start);
    const end = parseFestivalDate(props.item.entry.end);
    return `${formatTime(start)} - ${formatTime(end)}`;
  }
  const start = new Date(props.item.subEvent.startTime * 1000);
  const end = new Date(props.item.subEvent.endTime * 1000);
  return `${formatTime(start)} - ${formatTime(end)}`;
});

const venueLabel = computed(() => {
  if (!props.venueMarkers?.length) return "";
  const zones = props.venueZones ?? [];
  const resolve =
    props.locationFormat === "full"
      ? resolveFullLocationLabel
      : resolveShortLocationLabel;
  let label = "";
  if (props.item.type === "official" && props.item.entry.venueMarkerId) {
    label = resolve(props.item.entry.venueMarkerId, props.venueMarkers, zones);
  } else if (
    props.item.type === "community" &&
    props.item.subEvent.metadata.location
  ) {
    label = resolve(
      props.item.subEvent.metadata.location,
      props.venueMarkers,
      zones,
    );
  }
  return truncate(label, LOCATION_LABEL_MAX_CHARS);
});

const detailRoute = computed(() => {
  if (props.item.type === "official") return `/program/${props.item.entry.id}`;
  return `/sessions/${props.item.subEvent.address}`;
});

const bookmarkPayload = computed<BookmarkPayload>(() => ({
  startMs:
    props.item.type === "official"
      ? parseFestivalDate(props.item.entry.start).getTime()
      : props.item.subEvent.startTime * 1000,
  title: title.value,
  deeplink: `/#${detailRoute.value}`,
  location: venueLabel.value || undefined,
}));

const editRoute = computed(() => {
  if (props.item.type !== "community") return "";
  return `/my/manage/${props.item.subEvent.address}/edit`;
});

// Text color helpers. Owner cards have dark text on white bg
const titleClass = computed(() => {
  if (past.value) return "text-text-and-icons-primary";
  if (isOwner.value) return "text-black";
  return "text-text-primary";
});

const mutedClass = computed(() => {
  if (past.value) return "text-text-and-icons-secondary";
  if (isOwner.value) return "text-black/50";
  return "text-text-muted";
});

const timeClass = computed(() => {
  if (past.value) return 'text-text-and-icons-secondary'
  if (isOwner.value) return 'text-black'
  if (ongoing.value) return 'text-text-and-icons-primary'
  return 'text-text-muted'
})

function formatTime(d: Date): string {
  return formatTimeBerlin(d);
}

const { flyToCounter } = useMyListFlyAnimation();

function onStarTap(e: MouseEvent) {
  const adding = !props.isBookmarked;
  if (adding) {
    const trigger = e.currentTarget as HTMLElement;
    const card = trigger.closest(
      '[data-testid="program-card"]',
    ) as HTMLElement | null;
    if (card)
      flyToCounter(card, { title: title.value, subtitle: timeRange.value });
  }
  emit("toggleBookmark", itemId.value, bookmarkPayload.value);
}
</script>

<template>
  <NuxtLink
    :to="detailRoute"
    class="block rounded-xl p-3 border transition-colors"
    :class="cardClass"
    data-testid="program-card"
  >
    <div class="flex items-start gap-2.5">
      <!-- Left accent bar -->
      <div
        class="w-[3px] shrink-0 self-stretch rounded-full my-0.5"
        :style="{ backgroundColor: accentColor }"
      />
      <div class="flex-1 min-w-0">
        <!-- Top row: title/subtitle + right action -->
        <div class="flex items-start gap-2.5">
          <div class="flex-1 min-w-0">
            <!-- Title row with ongoing dot -->
            <div class="flex items-start gap-1.5">
              <span
                v-if="ongoing"
                class="w-1.5 h-1.5 rounded-full shrink-0 bg-danger mt-1.5"
              />
              <p
                class="text-sm font-medium line-clamp-3 leading-snug"
                :class="titleClass"
              >
                {{ title }}
              </p>
            </div>

            <!-- Speaker / creator / My Session -->
            <p v-if="subtitle" class="text-xs mt-0.5" :class="mutedClass">
              {{ subtitle }}
            </p>
          </div>

          <!-- Right action: pencil for owner, star for others -->
          <template v-if="!past">
            <!-- Owner: pencil edit icon -->
            <NuxtLink
              v-if="isOwner"
              :to="editRoute"
              class="shrink-0 p-1 -mr-1 mt-0.5 text-black"
              @click.stop
            >
              <PencilIcon :size="18" />
            </NuxtLink>

            <!-- Non-owner: bookmark star -->
            <button
              v-else-if="isCheckedIn"
              class="shrink-0 p-1 -mr-1 mt-0.5 transition-colors program-card-star"
              :class="[
                isBookmarked
                  ? 'text-text-primary program-card-star--filled'
                  : 'text-stone-600',
              ]"
              @click.prevent.stop="onStarTap"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                :fill="isBookmarked ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
              </svg>
            </button>
          </template>
        </div>

        <!-- Time + venue (spans to right card margin) -->
        <div class="text-xs mt-2 flex items-start justify-between gap-2">
          <span :class="timeClass" class="whitespace-nowrap shrink-0">{{ timeRange }}<span v-if="past"> Ended </span></span>
          <span v-if="venueLabel" :class="mutedClass" class="text-left">{{ venueLabel }}</span>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>

<style scoped>
.program-card-star {
  transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.program-card-star--filled {
  transform: scale(1.15);
}
</style>
