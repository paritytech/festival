<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import FestivalPoapBadge from '~/components/FestivalPoapBadge.vue'

const props = defineProps<{
  /** SS58 (or any stable string) used to derive the badge background color. */
  address: string
  /** Display name shown under the badge. */
  festivalName?: string
  /** Timestamp (ms epoch) of activation; formatted for the "Received" line. */
  receivedAtMs?: number
}>()

const emit = defineEmits<{ next: [] }>()

// Always English + Berlin time (24h). The festival is held in Berlin and the
// app's copy is English, so device locale must not leak into this label.
const receivedFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Berlin',
})
const receivedLabel = computed(() => {
  const ts = props.receivedAtMs ?? Date.now()
  return receivedFormatter.format(new Date(ts))
})

// Escape advances like the CTA. CTA focused on mount so SRs announce the
// title and keyboard users land on the only action.
const emitNext = () => emit('next')
const backBtnRef = ref<HTMLButtonElement | null>(null)
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emitNext()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  void nextTick(() => backBtnRef.value?.focus())
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="badge-earned-festival fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2110] overflow-hidden bg-bg-surface-main text-text-and-icons-primary"
      data-testid="badge-earned-festival-screen"
      role="dialog"
      aria-labelledby="badge-earned-title"
    >
      <h1 id="badge-earned-title" class="title">
        You've earned<br />a badge!
      </h1>

      <div class="badge-wrap">
        <div class="badge">
          <FestivalPoapBadge :address="address" />
        </div>
      </div>

      <div class="info">
        <p class="name">{{ festivalName || 'Web3 Summit' }}</p>
        <p class="received">Received: {{ receivedLabel }}</p>
      </div>

      <!-- Spacer pins the CTA to the bottom on tall viewports without
           crowding the info on short ones. -->
      <div class="spacer" aria-hidden="true" />

      <button
        ref="backBtnRef"
        type="button"
        class="cta"
        data-testid="badge-earned-festival-next"
        @click="emitNext"
      >
        Next
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.badge-earned-festival {
  font-family: var(--font-body, 'Inter', sans-serif);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding-top: calc(var(--safe-top, 0px) + 56px);
  padding-bottom: calc(var(--safe-bottom, 0px) + 24px);
}

.title {
  flex: 0 0 auto;
  margin: 40px 16px 0;
  text-align: center;
  font-size: 32px;
  line-height: 38px;
  font-weight: 600;
  opacity: 0;
  animation: text-rise 500ms 600ms cubic-bezier(0.3, 0.7, 0.4, 1) forwards;
}

/* Shrinks below 232px on narrow viewports; aspect-ratio keeps the art square. */
.badge-wrap {
  flex: 0 0 auto;
  margin: 56px auto 0;
  width: min(232px, calc(100% - 64px));
  aspect-ratio: 1 / 1;
  perspective: 800px;
}
.badge {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 16px;
  overflow: hidden;
  transform-origin: center;
  transform: scale(0) rotate(-180deg);
  animation: badge-pop 700ms 400ms cubic-bezier(0.4, 1.4, 0.5, 1) forwards;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
@keyframes badge-pop {
  0%   { transform: scale(0) rotate(-180deg); }
  60%  { transform: scale(1.1) rotate(10deg); }
  80%  { transform: scale(0.95) rotate(-3deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.info {
  flex: 0 0 auto;
  margin: 28px 16px 0;
  text-align: center;
  opacity: 0;
  animation: text-rise 500ms 1000ms cubic-bezier(0.3, 0.7, 0.4, 1) forwards;
}
.info .name {
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
  margin: 0 0 6px 0;
}
.info .received {
  font-size: 14px;
  line-height: 20px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
}

@keyframes text-rise {
  0%   { opacity: 0; transform: translateY(16px); }
  100% { opacity: 1; transform: translateY(0); }
}

.spacer {
  flex: 1 1 auto;
  min-height: 24px;
}

.cta {
  flex: 0 0 auto;
  margin: 0 24px;
  height: 56px;
  border-radius: 28px;
  background: #ffffff;
  color: #000000;
  border: none;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  opacity: 0;
  animation: cta-reveal 500ms 1200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes cta-reveal {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cta:hover {
  background: #f3f3f2;
}

@media (prefers-reduced-motion: reduce) {
  .title,
  .badge,
  .info,
  .cta {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }
}
</style>
