<script setup lang="ts">
defineProps<{
  forceShowQr?: boolean;
}>();
defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[2000] flex flex-col bg-black/85 backdrop-blur-md"
      data-testid="passport-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div class="flex-1 overflow-y-auto px-4 pt-[calc(env(safe-area-inset-top)+24px)] pb-4 flex items-center justify-center">
        <div class="w-full max-w-sm">
          <HomePassport :force-show-qr="forceShowQr" />
        </div>
      </div>

      <div class="px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-2">
        <button
          class="block w-full py-4 rounded-2xl bg-white text-black text-base font-semibold"
          data-testid="passport-overlay-close"
          @click="$emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </Teleport>
</template>
