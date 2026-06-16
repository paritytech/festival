<script setup lang="ts">
import { watch, onBeforeUnmount, useId } from 'vue'
import { useQRScanner } from '@festival/shared/scanner/useQRScanner'

const props = defineProps<{
  active: boolean
}>()

const emit = defineEmits<{
  scan: [data: string]
  error: [message: string]
}>()

const elementId = `qr-scanner-${useId()}`
const { start, stop, isActive, error } = useQRScanner()

watch(
  () => props.active,
  async (active) => {
    if (active && !isActive.value) {
      await start(elementId, (data) => emit('scan', data))
      if (error.value) emit('error', error.value)
    } else if (!active && isActive.value) {
      await stop()
    }
  },
  { immediate: true },
)

watch(error, (err) => {
  if (err) emit('error', err)
})

onBeforeUnmount(() => stop())
</script>

<template>
  <div class="qr-scanner-root">
    <div :id="elementId" class="scanner-surface overflow-hidden" />
    <p v-if="error" class="text-xs text-red-600 mt-2">{{ error }}</p>
  </div>
</template>

<style scoped>
.qr-scanner-root {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/*
 * Let html5-qrcode size its own <video> (as the admin scanner does). Forcing
 * width/height + object-fit on the video desynced the displayed frame from the
 * region html5-qrcode actually decodes, so visible QRs never decoded.
 */
.scanner-surface {
  width: 100%;
}
</style>
