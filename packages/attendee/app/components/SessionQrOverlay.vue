<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useWalletStore } from "@festival/shared/host/wallet";
import { generateQRDataUrl } from "@festival/shared/scanner/useQRImage";

defineEmits<{ close: [] }>();

const wallet = useWalletStore();
const qrDataUrl = ref("");

async function generateQR() {
  if (!wallet.address) {
    qrDataUrl.value = "";
    return;
  }
  try {
    qrDataUrl.value = await generateQRDataUrl(wallet.address, {
      width: 512,
      margin: 1,
    });
  } catch (err) {
    console.warn("[SessionQrOverlay] failed to generate qr", err);
  }
}

onMounted(generateQR);
watch(() => wallet.address, generateQR);
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2000] flex flex-col bg-black"
      data-testid="session-qr-overlay"
      role="dialog"
      aria-modal="true"
    >
      <SessionTopBar
        title="QR Code"
        back-testid="session-qr-back"
        back-aria-label="Back"
        @back="$emit('close')"
      />

      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <div class="rounded-3xl bg-white p-6">
          <img
            v-if="qrDataUrl"
            :src="qrDataUrl"
            alt="Your QR code"
            class="w-64 h-64"
            data-testid="session-qr-image"
          />
        </div>
        <p class="mt-8 text-xl font-semibold text-white text-center">
          Show this QR to the host
        </p>
      </div>

      <div class="px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2">
        <button
          class="block w-full py-4 rounded-2xl bg-white text-black text-base font-semibold"
          data-testid="session-qr-close"
          @click="$emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </Teleport>
</template>
