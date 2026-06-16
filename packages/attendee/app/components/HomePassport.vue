<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useWalletStore } from "@festival/shared/host/wallet";
import { FESTIVAL_ADDRESS } from "@festival/shared/contracts/addresses";
import { useFestival } from "~/composables/useFestival";
import { useRegistration } from "~/composables/useRegistration";
import { useFestivalPass } from "~/composables/useFestivalPass";
import { generateQRDataUrl } from "@festival/shared/scanner/useQRImage";
import QrSpoiler from "~/components/QrSpoiler.vue";

const props = defineProps<{
  forceShowQr?: boolean;
}>();

const wallet = useWalletStore();
const { metadata } = useFestival();
const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS);
const { passStatus } = useFestivalPass();

const showQr = computed(() => !isCheckedIn.value || props.forceShowQr);
const isDeferred = computed(() => passStatus.value === "deferred");

const BAND_SIDE = "PRIVACY IS DIGNITY · USABILITY MAKES IDEALS REAL · ";
const BAND_CENTER = "SOVEREIGNTY IS AGENCY";
const NOT_CHECKED_IN_BAND = "NOT CHECKED-IN YET · ";
const ACTIVATE_BAND = "ACTIVATE YOUR PASS    ";
const REVEAL_DURATION = 10;

const festivalName = computed(() => metadata.value?.name || "WEB3 SUMMIT");

// ── QR state ──

const realQrDataUrl = ref("");
const revealed = ref(false);
const countdown = ref(REVEAL_DURATION);

let countdownInterval: ReturnType<typeof setInterval> | null = null;

async function generateRealQR() {
  if (!wallet.address) {
    realQrDataUrl.value = "";
    return;
  }
  try {
    realQrDataUrl.value = await generateQRDataUrl(wallet.address, {
      width: 256,
      margin: 1,
    });
  } catch (err) {
    console.warn("[HomePassport] failed to generate real QR", err);
  }
}

// ── Reveal / hide ──

function reveal() {
  if (!realQrDataUrl.value || revealed.value) return;
  revealed.value = true;
  countdown.value = REVEAL_DURATION;
  countdownInterval = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) hide();
  }, 1000);
}

function hide() {
  revealed.value = false;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// ── Lifecycle ──

onMounted(() => {
  generateRealQR();
});

watch(
  () => wallet.address,
  () => {
    generateRealQR();
    if (revealed.value) hide();
  },
);

onUnmounted(() => {
  if (countdownInterval) clearInterval(countdownInterval);
});
</script>

<template>
  <div
    class="rounded-3xl overflow-hidden"
    style="background: linear-gradient(135deg, #FFFFFF 0%, #CFCFCF 100%)"
    data-testid="home-passport"
  >
    <!-- Header -->
    <div class="pl-4 pr-6 pt-6 flex items-center justify-between gap-3">
      <div>
        <p class="text-lg uppercase font-mono font-medium text-black leading-tight" data-testid="passport-festival-name">
          {{ festivalName }}
        </p>
        <p class="text-lg font-semibold text-black leading-tight">Your Pass</p>
      </div>
      <img src="/w3s-logo.png" alt="W3S" width="53" height="22.05" class="shrink-0" />
    </div>

    <!-- Marquee band: amber ACTIVATE when the pass is deferred, red NOT
         CHECKED-IN YET before check-in, sovereignty otherwise. -->
    <div
      v-if="isDeferred"
      class="bg-activations h-8 flex items-center mt-20 overflow-hidden"
      data-testid="passport-band-activate"
    >
      <div class="flex w-max marquee-track">
        <p
          class="text-black uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-checked-in"
        >
          {{ ACTIVATE_BAND.repeat(8) }}
        </p>
        <p
          aria-hidden="true"
          class="text-black uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-checked-in"
        >
          {{ ACTIVATE_BAND.repeat(8) }}
        </p>
      </div>
    </div>
    <div
      v-else-if="isCheckedIn"
      class="bg-black h-8 flex items-center mt-20 overflow-hidden"
      data-testid="passport-band-checked-in"
    >
      <div class="flex w-max marquee-track">
        <p
          class="text-white uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-checked-in"
        >
          {{ BAND_SIDE }}{{ BAND_SIDE }}{{ BAND_CENTER }} · {{ BAND_SIDE
          }}{{ BAND_SIDE }}
        </p>
        <p
          aria-hidden="true"
          class="text-white uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-checked-in"
        >
          {{ BAND_SIDE }}{{ BAND_SIDE }}{{ BAND_CENTER }} · {{ BAND_SIDE
          }}{{ BAND_SIDE }}
        </p>
      </div>
    </div>
    <div
      v-else
      class="bg-passport-band-not-checked-in h-8 flex items-center mt-20 overflow-hidden"
      data-testid="passport-band-not-checked-in"
    >
      <div class="flex w-max marquee-track">
        <p
          class="text-white uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-not-checked-in"
        >
          {{ NOT_CHECKED_IN_BAND.repeat(8) }}
        </p>
        <p
          aria-hidden="true"
          class="text-white uppercase whitespace-nowrap font-mono font-normal pr-6 shrink-0 text-passport-band-not-checked-in"
        >
          {{ NOT_CHECKED_IN_BAND.repeat(8) }}
        </p>
      </div>
    </div>

    <!-- QR code (hidden once checked in unless forced, e.g. session check-in) -->
    <div
      v-if="showQr"
      class="pl-4 pr-6 pt-12 pb-4"
      data-testid="passport-reveal-area"
      @click="reveal"
    >
      <div
        class="relative mx-auto rounded-xl bg-white p-3"
        style="width: 200px"
      >
        <!-- Revealed: real QR -->
        <img
          v-if="revealed && realQrDataUrl"
          :src="realQrDataUrl"
          alt="Your QR code"
          class="w-full aspect-square"
          style="image-rendering: pixelated"
          data-testid="passport-real-qr"
        />
        <!-- Spoiler: animated particle canvas while QR is hidden -->
        <div
          v-if="!revealed"
          class="relative w-full aspect-square cursor-pointer bg-white overflow-hidden"
        >
          <QrSpoiler class="absolute inset-0" :active="!revealed" />
        </div>
      </div>
      <p
        class="text-black/70 text-center mt-3 uppercase font-mono font-normal text-passport-caption"
      >
        <template v-if="revealed">EXPIRES IN: {{ countdown }}S</template>
        <template v-else>TAP TO REVEAL QR CODE</template>
      </p>
    </div>
    <!-- Bottom spacing when QR is hidden -->
    <div v-else class="pb-12" />
  </div>
</template>

<style scoped>
.marquee-track {
  animation: marquee 240s linear infinite;
  will-change: transform;
}

@keyframes marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
</style>
