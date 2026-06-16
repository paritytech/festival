<script setup lang="ts">
import { ref, reactive, computed, watch, useTemplateRef, nextTick } from "vue";
import type { PickedLocation } from "@festival/shared/venue/floors";
import { useFestival } from "~/composables/useFestival";
import { useVenueMap } from "~/composables/useVenueMap";
import { usePoaps } from "~/composables/usePoaps";
import { useRegistration } from "~/composables/useRegistration";
import { useSubEvents } from "~/composables/useSubEvents";
import { usePassGate } from "~/composables/usePassGate";
import { useSessionLimit } from "~/composables/useSessionLimit";
import { useNow } from "~/composables/useNow";
import type { TxStatus } from "@festival/shared/contracts/write";
import type { SubEventMetadata } from "@festival/shared/metadata/schemas";
import { randomAnonymousSpeakerName } from "@festival/shared/metadata/anonymousSpeaker";
import { writeContract } from "@festival/shared/contracts/write";
import { FestivalABI } from "@festival/shared/contracts/abis";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { useBulletinStorage } from "@festival/shared/metadata/bulletin";
import { formatTxError } from "@festival/shared/contracts/errors";
import { useWalletStore } from "@festival/shared/host/wallet";
import { ss58ToH160, isValidEvmAddress } from "@festival/shared/utils/address";
import { festivalState } from "@festival/shared/cache/festival-state";
import { addPending, dropPending, draftSessionEntry } from "@festival/shared/cache/pending";
import {
  encodeCoordLocation,
  resolveFullLocationLabel,
} from "@festival/shared/venue/floors";
import {
  getValidFestivalDays,
  getValidStartSlots,
  getValidEndSlots,
  validateSessionTime,
  berlinMinuteToDate,
  formatTimeLabel,
  type SessionTimeValidationFailReason,
} from "@festival/shared";

const wallet = useWalletStore();
const { metadata: festivalMetadata, details: festivalDetails } = useFestival();
const { festivalPoaps } = usePoaps();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { subEvents, reload: reloadSubEvents } = useSubEvents();
const gate = usePassGate("create a session");
const { fullDateKeys } = useSessionLimit();

watch(
  isCheckedIn,
  (checkedIn) => {
    if (!checkedIn) navigateTo("/", { replace: true });
  },
  { immediate: true },
);

const now = useNow();

// ── Step management ──

const currentStep = ref<1 | 2 | 3 | 4>(1);
const showDiscardModal = ref(false);

const stepTitle = computed(() => {
  const titles: Record<number, string> = {
    1: "Session Details",
    2: "Session Location",
    3: "Session Badge",
    4: "Session Overview",
  };
  return titles[currentStep.value];
});

// ── Form state (persists across all steps) ──

const form = reactive({
  name: "",
  speaker: "",
  description: "",
  dateKey: "",
  startMinutesOfDay: null as number | null,
  endMinutesOfDay: null as number | null,
});

const submitValidationError = ref<SessionTimeValidationFailReason | null>(null);
const pickedLocation = ref<PickedLocation | null>(null);
const pickerOpen = ref(false);
const badgeHex = ref("");

const fallbackSpeaker = ref(
  randomAnonymousSpeakerName(
    subEvents.value.flatMap((s) => s.metadata.speakers),
  ),
);

const stepBodyRef = useTemplateRef<HTMLDivElement>("stepBodyRef");

function handlePickerDone(loc: PickedLocation) {
  pickedLocation.value = loc;
  pickerOpen.value = false;
  // Reset scroll so the preview lands at the top, not at the pre-modal offset.
  nextTick(() => stepBodyRef.value?.scrollTo({ top: 0 }));
}

// All three steps share one scroll container; without this, scroll offset
// from a long Step 1 form leaks into Step 2/3, landing them pre-scrolled.
watch(currentStep, () => {
  nextTick(() => stepBodyRef.value?.scrollTo({ top: 0 }));
});

const txStatus = ref<TxStatus>("idle");
const error = ref<string | null>(null);
const createdAddress = ref<string | null>(null);

// ── Step 1 ref for canProceed ──

const stepDetailsRef = ref<{ canProceed: boolean } | null>(null);

const canProceedStep1 = computed(
  () => stepDetailsRef.value?.canProceed ?? false,
);

// ── Festival window + valid hour grids (driven by timeWindow util) ──

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

// Time labels for SessionPreviewCard (the success/in-flight overlays).
const startTimeLabel = computed(() =>
  form.startMinutesOfDay != null ? formatTimeLabel(form.startMinutesOfDay) : "",
);
const endTimeLabel = computed(() =>
  form.endMinutesOfDay != null ? formatTimeLabel(form.endMinutesOfDay) : "",
);

// ── Venue markers ──

const { markers: venueMarkers, zones: venueZones } = useVenueMap();

// ── Navigation ──

const hasAnyData = computed(
  () =>
    form.name !== "" ||
    form.speaker !== "" ||
    form.description !== "" ||
    form.dateKey !== "" ||
    form.startMinutesOfDay != null ||
    form.endMinutesOfDay != null ||
    pickedLocation.value !== null ||
    badgeHex.value !== "",
);

function goNext() {
  if (currentStep.value === 1) currentStep.value = 2;
  else if (currentStep.value === 2) currentStep.value = 3;
  else if (currentStep.value === 3) currentStep.value = 4;
}

function goBack() {
  if (currentStep.value === 4) currentStep.value = 3;
  else if (currentStep.value === 3) currentStep.value = 2;
  else if (currentStep.value === 2) currentStep.value = 1;
}

function handleClose() {
  if (hasAnyData.value) {
    showDiscardModal.value = true;
  } else {
    navigateTo("/");
  }
}

function confirmDiscard() {
  showDiscardModal.value = false;
  navigateTo("/");
}

// ── Build metadata ──

function buildMetadata(): SubEventMetadata {
  const location = pickedLocation.value
    ? encodeCoordLocation(
        pickedLocation.value.floorId,
        pickedLocation.value.zoneId,
        pickedLocation.value.x,
        pickedLocation.value.y,
      )
    : "";
  const speaker = form.speaker.trim() || fallbackSpeaker.value;
  return {
    version: "1.0",
    type: "sub-event",
    name: form.name,
    description: form.description,
    location,
    speakers: [speaker],
    badgeHex: badgeHex.value || undefined,
  };
}

// ── Success screen helpers ──

const pickedLocationLabel = computed(() => {
  const loc = pickedLocation.value;
  if (!loc) return "";
  return resolveFullLocationLabel(
    encodeCoordLocation(loc.floorId, loc.zoneId, loc.x, loc.y),
    venueMarkers.value,
    venueZones.value,
  );
});

const isCreatingSession = computed(
  () =>
    txStatus.value !== "idle" &&
    txStatus.value !== "error" &&
    !createdAddress.value,
);

// ── Submit ──

async function submit() {
  if (
    !form.name ||
    !form.dateKey ||
    form.startMinutesOfDay == null ||
    form.endMinutesOfDay == null
  )
    return;
  error.value = null;
  submitValidationError.value = null;

  // Re-validate against the live festival window, catching clock drift between
  // picking a time and tapping submit. Location and badge are preserved.
  const w = festivalWindow.value;
  if (w) {
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
      currentStep.value = 1;
      return;
    }
  }

  gate.run(doCreate);
}

async function doCreate() {
  if (form.startMinutesOfDay == null || form.endMinutesOfDay == null) return;
  // CID of the in-flight draft, visible to the catch for rollback.
  let pendingCid: `0x${string}` | null = null;
  txStatus.value = "preparing";
  try {
    if (!wallet.isConnected) throw new Error("Wallet not connected");

    const myFestivalPoap = festivalPoaps.value[0];
    const poapTokenId = myFestivalPoap ? BigInt(myFestivalPoap.tokenId) : 0n;
    if (poapTokenId === 0n) {
      throw new Error(
        "You need a festival POAP (check in first) or an admin/manager role to create sessions.",
      );
    }

    // Must succeed before the on-chain write: a zero CID would leave the
    // session with no name or image in the agenda.
    const metadata = buildMetadata();
    const { storePlaintext } = useBulletinStorage();
    const { bytes32 } = await storePlaintext(metadata).catch(
      (e): never => {
        console.error("[SubEvent Create] Bulletin upload failed:", e);
        throw new Error("Couldn't save your session. Please try again.", { cause: e });
      },
    );

    txStatus.value = "signing";

    const startTs = BigInt(
      Math.floor(
        berlinMinuteToDate(form.dateKey, form.startMinutesOfDay).getTime() /
          1000,
      ),
    );
    const endTs = BigInt(
      Math.floor(
        berlinMinuteToDate(form.dateKey, form.endMinutesOfDay).getTime() / 1000,
      ),
    );

    const creatorH160 = (
      isValidEvmAddress(wallet.address)
        ? wallet.address.toLowerCase()
        : ss58ToH160(wallet.address).toLowerCase()
    ) as `0x${string}`;
    pendingCid = bytes32;

    await writeContract({
      address: FESTIVAL_ADDRESS as `0x${string}`,
      abi: FestivalABI,
      functionName: "createSession",
      args: [bytes32, startTs, endTs, poapTokenId],
      signer: wallet.getSigner(),
      walletAddress: wallet.address,
      onStatus: (s) => {
        txStatus.value = s;
        // The draft renders in lists immediately; the confirmed entry with
        // this CID supersedes it, and the catch below rolls it back.
        if (s === "broadcasting") {
          addPending(
            "session",
            bytes32,
            draftSessionEntry(bytes32, startTs, endTs, creatorH160, metadata),
          );
        }
      },
    });

    // The tx succeeded, so the draft has done its job either way.
    dropPending("session", bytes32);
    // Resolve the created address by its CID, which is unique to this
    // creation. Prefer a live match, fall back to a cancelled one for the
    // rare create then instant cancel case.
    try {
      await reloadSubEvents();
      const byCid = (live: boolean) =>
        festivalState.sessions.find(
          (s) =>
            (!live || !s.details.cancelled) &&
            s.details.metadataCid.toLowerCase() === bytes32.toLowerCase(),
        );
      createdAddress.value = (byCid(true) ?? byCid(false))?.address ?? FESTIVAL_ADDRESS;
    } catch {
      createdAddress.value = FESTIVAL_ADDRESS;
    }
  } catch (e: any) {
    if (pendingCid) dropPending("session", pendingCid);
    txStatus.value = "error";
    error.value = formatTxError(e);
  }
}
</script>

<template>
  <!-- ── Creating session… intermediate overlay ── -->
  <Transition name="slide-up">
    <div
      v-if="isCreatingSession"
      data-testid="session-creating-overlay"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-background flex flex-col z-[60] pt-[var(--safe-top)]"
    >
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <div class="w-full max-w-[244px]">
          <SessionPreviewCard
            :name="form.name"
            :start-time="startTimeLabel"
            :end-time="endTimeLabel"
            :location-label="pickedLocationLabel"
            :badge-hex="badgeHex"
          />
        </div>

        <div class="flex items-center gap-3 mt-8">
          <div
            class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"
          />
          <p class="text-base font-semibold text-white">Creating session…</p>
        </div>
      </div>
    </div>
  </Transition>

  <!-- ── Success screen overlay ── -->
  <Transition name="slide-up">
    <div
      v-if="createdAddress"
      data-testid="session-success-overlay"
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] bg-background flex flex-col z-[60] pt-[var(--safe-top)]"
    >
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <div class="w-full max-w-[244px]">
          <SessionPreviewCard
            :name="form.name"
            :start-time="startTimeLabel"
            :end-time="endTimeLabel"
            :location-label="pickedLocationLabel"
            :badge-hex="badgeHex"
          />
        </div>

        <h1
          data-testid="session-success-heading"
          class="text-2xl font-bold text-white text-center leading-tight mt-8"
        >
          Session created<br />successfully
        </h1>
      </div>

      <div class="px-4 pb-[calc(var(--safe-bottom)+24px)] space-y-3">
        <NuxtLink
          :to="{ path: `/sessions/${createdAddress}`, query: { from: 'create' } }"
          data-testid="session-success-view"
          class="block w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold text-center"
        >
          View your Session
        </NuxtLink>
        <NuxtLink
          to="/program"
          data-testid="session-success-back"
          class="block w-full py-4 bg-surface-2 text-white rounded-2xl text-sm font-medium text-center"
        >
          Back to Program
        </NuxtLink>
      </div>
    </div>
  </Transition>

  <!-- ── Discard modal ── -->
  <ConfirmModal
    :visible="showDiscardModal"
    title="Discard session?"
    message="If you leave now, your session details won't be saved."
    confirm-label="Discard"
    @confirm="confirmDiscard"
    @cancel="showDiscardModal = false"
  />

  <!-- ── Stepper ── -->
  <div
    v-if="!isCreatingSession && !createdAddress"
    class="flex flex-col min-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom))] -mx-4"
  >
    <!-- Header -->
    <div class="px-4 pt-4 pb-3 flex items-center">
      <!-- Step 1: X close. Steps 2-3: back arrow -->
      <button
        class="w-10 h-10 flex items-center justify-center -ml-2"
        @click="currentStep === 1 ? handleClose() : goBack()"
      >
        <!-- X icon (step 1) -->
        <svg
          v-if="currentStep === 1"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="text-white"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <!-- Back arrow (steps 2-3) -->
        <BackIcon v-else class="text-text-and-icons-primary" />
      </button>

      <!-- Centered title -->
      <h1 class="flex-1 text-center text-base font-semibold text-white">
        {{ stepTitle }}
      </h1>

      <!-- Spacer to balance the header -->
      <div class="w-10" />
    </div>

    <div v-if="currentStep < 4" class="px-4 pb-4">
      <StepProgressBar :steps="3" :current-step="currentStep" />
    </div>

    <!-- Step content -->
    <div ref="stepBodyRef" class="flex-1 overflow-y-auto">
      <!-- Step 1: Session Details -->
      <div v-if="currentStep === 1">
        <div
          v-if="submitValidationError"
          data-testid="session-revalidation-banner"
          class="mx-4 mb-4 rounded-2xl bg-red-900/30 border border-red-500/20 px-4 py-3"
        >
          <p class="text-sm text-red-300">
            Selected time is no longer available. Please pick a new date and
            time.
          </p>
        </div>

        <CreateStepDetails
          ref="stepDetailsRef"
          :model-value="form"
          :festival-days="festivalDays"
          :valid-start-slots="validStartSlots"
          :valid-end-slots="validEndSlots"
          :full-date-keys="fullDateKeys"
          @update:model-value="Object.assign(form, $event)"
        />
      </div>

      <!-- Step 2: Session Location -->
      <template v-if="currentStep === 2 && !pickerOpen">
        <SessionLocationIntro
          v-if="!pickedLocation"
          @open="pickerOpen = true"
        />
        <SessionLocationPreview
          v-else
          :loc="pickedLocation"
          :markers="venueMarkers"
          :zones="venueZones"
          @pick-another="pickerOpen = true"
        />
      </template>

      <!-- Step 3: Badge (intro or editor overlay) -->
      <CreateStepBadge
        v-if="currentStep === 3"
        v-model="badgeHex"
        :session-name="form.name"
        @done="currentStep = 4"
      />

      <!-- Step 4: Overview -->
      <CreateStepOverview
        v-if="currentStep === 4"
        :name="form.name"
        :speaker="form.speaker || fallbackSpeaker"
        :description="form.description"
        :date-key="form.dateKey"
        :start-minutes-of-day="form.startMinutesOfDay"
        :end-minutes-of-day="form.endMinutesOfDay"
        :badge-hex="badgeHex"
        :picked-location="pickedLocation"
        :venue-markers="venueMarkers"
        :venue-zones="venueZones"
        @edit="currentStep = $event"
      />
    </div>

    <!-- Step 3 (badge) supplies its own actions (intro "Create Badge" button and
         the full-screen editor's own header), so the wizard footer is hidden
         there — otherwise its empty bg-background bar overlaps the editor's
         bottom toolbar. -->
    <div
      v-if="currentStep !== 3"
      class="sticky bottom-0 z-10 px-4 pb-[calc(var(--safe-bottom)+24px)] pt-3 bg-background"
    >
      <!-- Step 1: Next -->
      <button
        v-if="currentStep === 1"
        data-testid="create-step1-next"
        class="w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold transition-colors disabled:opacity-40"
        :disabled="!canProceedStep1"
        @click="goNext"
      >
        Next
      </button>

      <!-- Step 2: Choose Location (intro state) or Next (preview state) -->
      <button
        v-if="currentStep === 2 && !pickedLocation"
        class="w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold transition-colors"
        @click="pickerOpen = true"
      >
        Choose Location
      </button>
      <button
        v-else-if="currentStep === 2"
        class="w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold transition-colors"
        @click="goNext"
      >
        Next
      </button>

      <!-- Step 4: Create Session -->
      <template v-if="currentStep === 4">
        <!-- Error -->
        <div
          v-if="error"
          class="rounded-2xl bg-red-900/30 border border-red-500/20 px-5 py-4 mb-3"
        >
          <p class="text-sm text-red-300">{{ error }}</p>
        </div>

        <!-- Submit button -->
        <button
          class="w-full py-4 bg-white text-black rounded-2xl text-sm font-semibold transition-colors disabled:opacity-40"
          :disabled="!badgeHex || (txStatus !== 'idle' && txStatus !== 'error')"
          @click="submit"
        >
          Create Session
        </button>
      </template>
    </div>
  </div>

  <!-- ── Session Location picker (full-screen modal, teleported to body) ── -->
  <SessionLocationPicker
    :open="pickerOpen"
    :initial="pickedLocation"
    :markers="venueMarkers"
    :zones="venueZones"
    @done="handlePickerDone"
    @cancel="pickerOpen = false"
  />

  <ActivationModal
    :visible="gate.state.value !== 'none'"
    v-bind="gate.modalProps.value"
    @primary="gate.onPrimary"
    @secondary="gate.onSecondary"
  />
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
