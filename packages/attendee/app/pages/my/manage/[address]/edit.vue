<script setup lang="ts">
import { ref, reactive, watch, computed, useTemplateRef } from "vue";
import { useSubEventManage } from "~/composables/useSubEventManage";
import { useSubEvents } from "~/composables/useSubEvents";
import { useFestival } from "~/composables/useFestival";
import { useNow } from "~/composables/useNow";
import type { SubEventMetadata } from "@festival/shared/metadata/schemas";
import { randomAnonymousSpeakerName } from "@festival/shared/metadata/anonymousSpeaker";
import { isValidEvmAddress } from "@festival/shared/utils/address";
import { decodeBadgeHex } from "@festival/shared/utils/badge";
import {
  encodeCoordLocation,
  parseCoordLocation,
  describePickedLocation,
  formatPickedLocationLong,
  type PickedLocation,
} from "@festival/shared/venue/floors";
import {
  getValidFestivalDays,
  getValidStartSlots,
  getValidEndSlots,
  validateSessionTime,
  dateKeyOf,
  SLOT_MIN,
  type SessionTimeValidationFailReason,
} from "@festival/shared";
import VenueMap from "~/components/VenueMap.vue";
import InputField from "~/components/ui/InputField.vue";

definePageMeta({
  validate: (route) => isValidEvmAddress(route.params.address as string),
});

const route = useRoute();
const router = useRouter();
const addr = route.params.address as string;

const { subEvents, isLoading: subEventsLoading } = useSubEvents();
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

const {
  metadata,
  details,
  isLoading,
  txStatus,
  error,
  handleUpdateMetadata,
  handleCancel,
} = useSubEventManage(addr);
const { metadata: festivalMetadata, details: festivalDetails } = useFestival();

const now = useNow();

// Redirect to the read-only session page once the session has ended.
watch(
  [details, now],
  ([d, n]) => {
    if (d && d.endTime !== 0n && Number(d.endTime) * 1000 <= n) {
      navigateTo(`/sessions/${addr}`, { replace: true });
    }
  },
  { immediate: true },
);

// ── Modals ──

const showDeleteModal = ref(false);
const showDiscardModal = ref(false);

// ── Festival window + valid hour grids ──

const festivalWindow = computed(() => {
  const d = festivalDetails.value;
  if (!d || d.startTime === 0n) return null;
  return {
    start: new Date(Number(d.startTime) * 1000),
    end: new Date(Number(d.endTime) * 1000),
  };
});

const festivalDays = computed(() => {
  const w = festivalWindow.value;
  if (!w) return [];
  return getValidFestivalDays(w.start, w.end, now.value);
});

// ── Venue markers ──

const venueMarkers = computed(
  () => festivalMetadata.value?.venueMap?.markers ?? [],
);

const venueZones = computed(
  () => festivalMetadata.value?.venueMap?.zones ?? [],
);

const badgePixels = computed(() => {
  const hex = metadata.value?.badgeHex;
  return hex ? decodeBadgeHex(hex) : null;
});

// ── Form state ──

const form = reactive({
  name: "",
  description: "",
  speakers: "",
  dateKey: "",
  startMinutesOfDay: null as number | null,
  endMinutesOfDay: null as number | null,
});

const submitValidationError = ref<SessionTimeValidationFailReason | null>(null);

const showUpdatedToast = ref(false);
const pendingSnapshot = ref<{
  name: string;
  description: string;
  speakers: string;
  dateKey: string;
  startMinutesOfDay: number | null;
  endMinutesOfDay: number | null;
  locationEncoded: string;
} | null>(null);

watch(txStatus, (s) => {
  if ((s === "in-block" || s === "finalized") && pendingSnapshot.value) {
    showUpdatedToast.value = true;
    Object.assign(original, pendingSnapshot.value);
    pendingSnapshot.value = null;
  } else if (s === "error") {
    pendingSnapshot.value = null;
  }
});

const validStartSlots = computed(() => {
  const w = festivalWindow.value;
  if (!w || !form.dateKey) return [];
  return getValidStartSlots(form.dateKey, w.start, w.end, now.value);
});

const validEndSlots = computed(() => {
  const w = festivalWindow.value;
  if (!w || !form.dateKey || form.startMinutesOfDay == null) return [];
  return getValidEndSlots(form.dateKey, form.startMinutesOfDay, w.end);
});

// Original values for dirty tracking
const original = reactive({
  name: "",
  description: "",
  speakers: "",
  dateKey: "",
  startMinutesOfDay: null as number | null,
  endMinutesOfDay: null as number | null,
  locationEncoded: "",
});

const isDirty = computed(
  () =>
    form.name !== original.name ||
    form.description !== original.description ||
    form.speakers !== original.speakers ||
    form.dateKey !== original.dateKey ||
    form.startMinutesOfDay !== original.startMinutesOfDay ||
    form.endMinutesOfDay !== original.endMinutesOfDay ||
    currentLocationEncoded.value !== original.locationEncoded,
);

// ── Map location picker ──

const pickedLocation = ref<PickedLocation | null>(null);
const pickerOpen = ref(false);
const previewMapRef =
  useTemplateRef<InstanceType<typeof VenueMap>>("previewMapRef");

const pickedLocationLabel = computed(() => {
  if (!pickedLocation.value) return "";
  return formatPickedLocationLong(
    describePickedLocation(
      pickedLocation.value,
      venueMarkers.value,
      venueZones.value,
    ),
  );
});

const currentLocationEncoded = computed(() => {
  if (!pickedLocation.value) return "";
  return encodeCoordLocation(
    pickedLocation.value.floorId,
    pickedLocation.value.x,
    pickedLocation.value.y,
  );
});

function handlePickerDone(loc: PickedLocation) {
  pickedLocation.value = loc;
  pickerOpen.value = false;
}

function handlePickerCancel() {
  pickerOpen.value = false;
}

// On the preview map, recenter on the pin and (if zoneId is missing from
// pre-fill) resolve it now that the SVG is mounted, so the label upgrades from
// "Custom location" to the proper zone name.
function handlePreviewReady() {
  const loc = pickedLocation.value;
  if (!loc) return;
  previewMapRef.value?.focusSpot(loc, { targetZoomDelta: 1, animate: false });
  if (loc.zoneId === null) {
    const zoneId = previewMapRef.value?.getZoneAt(loc.x, loc.y) ?? null;
    if (zoneId) pickedLocation.value = { ...loc, zoneId };
  }
}

// ── Pre-fill form from metadata ──

const formReady = ref(false);

/**
 * Convert a unix-seconds timestamp to its Berlin minutes-of-day, rounded down
 * to the nearest 15-minute slot. Off-grid existing sessions fall to the
 * preceding slot; if that slot isn't in the currently-valid set (e.g. session
 * is partly in the past), the picker watcher clears the field.
 */
function berlinMinutesFromTs(ts: number): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ts * 1000));
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  const total = hour * 60 + minute;
  return Math.floor(total / SLOT_MIN) * SLOT_MIN;
}

watch(
  [metadata, details],
  ([m, d]) => {
    if (m && d && !formReady.value) {
      const startMs = Number(d.startTime) * 1000;
      form.name = m.name;
      form.description = m.description;
      form.speakers = m.speakers.join(", ");
      form.dateKey = dateKeyOf(new Date(startMs));
      form.startMinutesOfDay = berlinMinutesFromTs(Number(d.startTime));
      form.endMinutesOfDay = berlinMinutesFromTs(Number(d.endTime));

      // Pre-fill location. zoneId is resolved later, after the preview map mounts
      // and we can hit-test the SVG via getZoneAt.
      if (m.location) {
        const coord = parseCoordLocation(m.location);
        if (coord) {
          pickedLocation.value = { ...coord, zoneId: null };
        }
      }

      // Store originals for dirty tracking
      original.name = form.name;
      original.description = form.description;
      original.speakers = form.speakers;
      original.dateKey = form.dateKey;
      original.startMinutesOfDay = form.startMinutesOfDay;
      original.endMinutesOfDay = form.endMinutesOfDay;
      original.locationEncoded = m.location || "";

      formReady.value = true;
    }
  },
  { immediate: true },
);

// ── Navigation guards ──

function handleBack() {
  if (isDirty.value) {
    showDiscardModal.value = true;
  } else {
    router.back();
  }
}

function confirmDiscard() {
  showDiscardModal.value = false;
  router.back();
}

// ── Delete ──

async function confirmDelete() {
  showDeleteModal.value = false;
  await handleCancel();
  if (txStatus.value !== "error") {
    navigateTo("/");
  }
}

// ── Submit ──

async function submit() {
  if (
    !form.name ||
    !form.dateKey ||
    form.startMinutesOfDay == null ||
    form.endMinutesOfDay == null
  )
    return;

  submitValidationError.value = null;

  // Re-validate against live `now` only if the user actually changed date/time.
  // If the original times are unchanged, leave them alone. Editing description
  // or location shouldn't be blocked by a session that's already running/past.
  const timeChanged =
    form.dateKey !== original.dateKey ||
    form.startMinutesOfDay !== original.startMinutesOfDay ||
    form.endMinutesOfDay !== original.endMinutesOfDay;

  const w = festivalWindow.value;
  if (timeChanged && w) {
    const check = validateSessionTime(
      {
        dateKey: form.dateKey,
        startMinutesOfDay: form.startMinutesOfDay,
        endMinutesOfDay: form.endMinutesOfDay,
      },
      w.start,
      w.end,
      new Date(),
    );
    if (!check.ok) {
      submitValidationError.value = check.reason;
      form.dateKey = "";
      form.startMinutesOfDay = null;
      form.endMinutesOfDay = null;
      return;
    }
  }

  const location = pickedLocation.value
    ? encodeCoordLocation(
        pickedLocation.value.floorId,
        pickedLocation.value.x,
        pickedLocation.value.y,
      )
    : "";

  const enteredSpeakers = form.speakers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const updated: SubEventMetadata = {
    version: "1.0",
    type: "sub-event",
    name: form.name,
    description: form.description,
    location,
    speakers: enteredSpeakers.length
      ? enteredSpeakers
      : [randomAnonymousSpeakerName()],
    badgeHex: metadata.value?.badgeHex,
  };

  pendingSnapshot.value = {
    name: form.name,
    description: form.description,
    speakers: form.speakers,
    dateKey: form.dateKey,
    startMinutesOfDay: form.startMinutesOfDay,
    endMinutesOfDay: form.endMinutesOfDay,
    locationEncoded: location,
  };

  await handleUpdateMetadata(updated);
}
</script>

<template>
  <!-- ── Delete modal ── -->
  <Transition name="fade">
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-black/80 z-[2000] flex items-end"
      @click.self="showDeleteModal = false"
    >
      <div
        class="w-full bg-surface rounded-t-3xl p-6 pb-[calc(var(--safe-bottom)+24px)]"
      >
        <h2 class="text-xl font-semibold text-white">Delete this session?</h2>
        <p class="text-sm text-text-muted mt-2">
          This action cannot be undone.
        </p>
        <button
          class="w-full py-4 bg-danger text-white rounded-2xl text-sm font-semibold mt-6"
          @click="confirmDelete"
        >
          Delete Session
        </button>
        <button
          class="w-full py-4 text-white text-sm font-medium mt-3"
          @click="showDeleteModal = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </Transition>

  <!-- ── Discard modal ── -->
  <Transition name="fade">
    <div
      v-if="showDiscardModal"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-black/80 z-[2000] flex items-end"
      @click.self="showDiscardModal = false"
    >
      <div
        class="w-full bg-surface rounded-t-3xl p-6 pb-[calc(var(--safe-bottom)+24px)]"
      >
        <h2 class="text-xl font-semibold text-white">Discard changes?</h2>
        <p class="text-sm text-text-muted mt-2">
          If you leave without updating, your changes won't be saved.
        </p>
        <button
          class="w-full py-4 bg-danger text-white rounded-2xl text-sm font-semibold mt-6"
          @click="confirmDiscard"
        >
          Discard
        </button>
        <button
          class="w-full py-4 text-white text-sm font-medium mt-3"
          @click="showDiscardModal = false"
        >
          Cancel
        </button>
      </div>
    </div>
  </Transition>

  <!-- ── Loading ── -->
  <div v-if="isLoading" class="flex items-center justify-center py-20">
    <div
      class="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"
    />
  </div>

  <!-- ── Edit form ── -->
  <div
    v-else
    class="flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] -mx-4"
  >
    <SessionTopBar title="Edit session’s details" @back="handleBack" />

    <!-- Form -->
    <div class="flex-1 px-4 pt-6 space-y-6 border-t border-white/12">
      <!-- Session Badge -->
      <div v-if="badgePixels" class="w-24 aspect-square rounded-2xl overflow-hidden">
        <BadgeCanvas :pixels="badgePixels" :size="96" />
      </div>

      <!-- Speakers -->
      <InputField v-slot="{ inputId }" label="Speakers">
        <input
          :id="inputId"
          v-model="form.speakers"
          type="text"
          placeholder="Alice, Bob"
          class="w-full bg-transparent text-text-and-icons-primary text-base leading-5 font-normal focus:outline-none placeholder-white/30"
        />
      </InputField>

      <!-- Session Name -->
      <InputField v-slot="{ inputId }" label="Session Name" required>
        <input
          :id="inputId"
          v-model="form.name"
          type="text"
          required
          aria-required="true"
          class="w-full bg-transparent text-text-and-icons-primary text-base leading-5 font-normal focus:outline-none placeholder-white/30"
        />
      </InputField>

      <!-- Submit-time revalidation banner -->
      <div
        v-if="submitValidationError"
        data-testid="session-revalidation-banner"
        class="rounded-2xl bg-red-900/30 border border-red-500/20 px-4 py-3"
      >
        <p class="text-sm text-red-300">
          Selected time is no longer available. Please pick a new date and time.
        </p>
      </div>

      <SessionDatePicker
        :days="festivalDays"
        :model-value="form.dateKey"
        @update:model-value="form.dateKey = $event"
      />

      <SessionTimePicker
        :start-minutes-of-day="form.startMinutesOfDay"
        :end-minutes-of-day="form.endMinutesOfDay"
        :valid-start-slots="validStartSlots"
        :valid-end-slots="validEndSlots"
        :disabled="!form.dateKey"
        @update:start-minutes-of-day="form.startMinutesOfDay = $event"
        @update:end-minutes-of-day="form.endMinutesOfDay = $event"
      />

      <SessionDescriptionField v-model="form.description" />

      <!-- Location -->
      <div v-if="!pickerOpen">
        <p v-if="pickedLocation" class="text-xs text-white/40">
          Selected Location
        </p>
        <p
          v-if="pickedLocation"
          class="text-lg font-semibold text-white leading-snug mt-0.5"
        >
          {{ pickedLocationLabel }}
        </p>

        <div
          class="mt-3 rounded-2xl bg-surface-2 overflow-hidden relative aspect-[4/3]"
        >
          <VenueMap
            v-if="pickedLocation"
            ref="previewMapRef"
            :markers="venueMarkers"
            :zones="venueZones"
            :active-floor-id="pickedLocation.floorId"
            :user-spot="{
              x: pickedLocation.x,
              y: pickedLocation.y,
              floorId: pickedLocation.floorId,
            }"
            :interactive="false"
            @ready="handlePreviewReady"
          />
          <div
            v-else
            class="absolute inset-0 flex items-center justify-center text-sm text-white/40"
          >
            No location set
          </div>

          <button
            type="button"
            class="absolute left-4 right-4 bottom-4 z-[1000] py-4 bg-white text-black rounded-2xl text-sm font-semibold shadow-lg"
            @click="pickerOpen = true"
          >
            Change Location
          </button>
        </div>
      </div>

      <!-- Error -->
      <div
        v-if="error"
        class="rounded-2xl bg-red-900/30 border border-red-500/20 px-5 py-4"
      >
        <p class="text-sm text-red-300">{{ error }}</p>
      </div>

      <!-- Delete -->
      <button
        class="w-full py-4 rounded-2xl text-sm font-normal text-danger"
        style="background-color: rgba(255, 49, 35, 0.08)"
        @click="showDeleteModal = true"
      >
        Delete Session
      </button>

      <div class="h-6" />
    </div>

    <!-- Sticky submit (only when dirty) -->
    <div
      v-if="isDirty"
      class="sticky bottom-0 px-4 pb-[calc(var(--safe-bottom)+24px)] pt-3 bg-background"
    >
      <button
        class="w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold transition-colors disabled:opacity-40"
        :disabled="
          !form.name ||
          !form.dateKey ||
          form.startMinutesOfDay == null ||
          form.endMinutesOfDay == null ||
          (txStatus !== 'idle' &&
            txStatus !== 'error' &&
            txStatus !== 'finalized')
        "
        @click="submit"
      >
        {{
          txStatus === "idle" ||
          txStatus === "error" ||
          txStatus === "finalized"
            ? "Update Session"
            : "Updating Session…"
        }}
      </button>
    </div>
  </div>

  <div class="fixed bottom-28 left-4 right-4 md:left-[calc(var(--col-l)+1rem)] md:right-[calc(var(--col-r)+1rem)] z-[1000] pointer-events-none">
    <SuccessToast
      :visible="showUpdatedToast"
      variant="check"
      message="Session Updated Successfully"
      @hide="showUpdatedToast = false"
    />
  </div>

  <!-- ── Change Location picker (full-screen modal, teleported to body) ── -->
  <SessionLocationPicker
    :open="pickerOpen"
    :initial="pickedLocation"
    :markers="venueMarkers"
    :zones="venueZones"
    title="Change Location"
    @done="handlePickerDone"
    @cancel="handlePickerCancel"
  />
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
</style>
