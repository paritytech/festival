<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { deriveFestivalColor } from '@festival/shared/utils/festivalColor'

const props = defineProps<{
  /** SS58 (or any stable string) used to derive the card color deterministically. */
  address: string
  /** Sub-headline above the festival title inside the ticket card. */
  passLabel?: string
  /** Headline inside the ticket card. */
  passTitle?: string
  /** Whether the activate flow is currently in-flight (chain call). */
  isActivating?: boolean
  /** Whether the post-success animation should play (converge + card explode). */
  isExploding?: boolean
}>()

const passLabelText = computed(() => props.passLabel || 'WEB3 SUMMIT 2026')
const passTitleText = computed(() => props.passTitle || 'Festival Pass')

const emit = defineEmits<{ activate: [] }>()

const cardColor = computed(() => deriveFestivalColor(props.address || ''))

// Latches once isExploding goes true so a brief prop flicker can't restart
// the keyframe sequence mid-flight.
const playingExplode = ref(false)
watch(
  () => props.isExploding,
  (v) => {
    if (v) playingExplode.value = true
  },
)

function onActivateClick() {
  if (props.isActivating || props.isExploding) return
  emit('activate')
}

// Focus the CTA on mount so screen readers announce the dialog title and
// keyboard users land on the only actionable element. No Escape. The pass
// is a soft block, the user must activate to proceed.
const activateBtnRef = ref<HTMLButtonElement | null>(null)
onMounted(() => {
  void nextTick(() => activateBtnRef.value?.focus())
})
</script>

<template>
  <Teleport to="body">
    <div
      class="festival-pass fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2100] overflow-hidden bg-background text-white"
      data-testid="festival-pass-screen"
      role="dialog"
      aria-labelledby="festival-pass-title"
    >
      <!-- Headline -->
      <h1 id="festival-pass-title" class="title">
        You've received<br />festival pass!
      </h1>

      <!-- Ticket card + ambient particles -->
      <div
        class="card-area"
        :class="{ 'is-exploding': playingExplode }"
      >
        <!-- Drift outward by default; on explode, .converge flies them back
             into the card center. Positions are %-based so they ride the
             card-area as it shrinks below 370px. -->
        <span
          v-for="p in particles"
          :key="p.id"
          class="particle"
          :style="{
            left: p.xPct + '%',
            top: p.yPct + '%',
            width: p.size + 'px',
            height: p.size + 'px',
            background: cardColor,
            animationDelay: p.delay + 'ms',
            '--dx': p.dx + 'px',
            '--dy': p.dy + 'px',
            '--cx': p.cx + 'px',
            '--cy': p.cy + 'px',
          }"
        />

        <svg
          class="card"
          width="370"
          height="186"
          viewBox="0 0 370 186"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <!-- Ticket body with side notches subtracted. -->
          <path
            d="M346 0C359.255 1.80392e-06 370 10.7452 370 24V69C356.745 69 346 79.7452 346 93C346 106.255 356.745 117 370 117V162C370 175.255 359.255 186 346 186H24C10.7452 186 0 175.255 0 162V117C13.2548 117 24 106.255 24 93C24 79.7452 13.2548 69 0 69V24C0 10.7452 10.7452 3.14076e-07 24 0H346Z"
            :fill="cardColor"
          />
          <!-- Pattern overlay: 12 squares at 18% opacity, clipped to the ticket. -->
          <g style="clip-path: inset(0 round 24px); opacity: 0.18">
            <rect x="33" y="32.91" width="24.39" height="24.39" fill="black" />
            <rect x="326" y="15" width="24.39" height="24.39" fill="black" />
            <rect x="350" y="39" width="24.39" height="24.39" fill="black" />
            <rect x="350" y="-9" width="24.39" height="24.39" fill="black" />
            <rect x="106" y="-7" width="24.39" height="24.39" fill="black" />
            <rect x="-12" y="-24" width="56.91" height="56.91" fill="black" />
            <rect x="297.99" y="133.47" width="24.39" height="24.39" fill="black" />
            <rect x="25" y="146.39" width="24.39" height="24.39" fill="black" />
            <rect x="1" y="121.39" width="24.39" height="24.39" fill="black" />
            <rect x="0" y="170.39" width="24.39" height="24.39" fill="black" />
            <rect x="106.22" y="145.99" width="48.78" height="48.78" fill="black" />
            <rect x="237" y="133.39" width="24.39" height="24.39" fill="black" />
          </g>
        </svg>

        <div class="card-label">
          <p class="card-label-sup">{{ passLabelText }}</p>
          <p class="card-label-title">{{ passTitleText }}</p>
        </div>
      </div>

      <p class="description">
        Activate your pass to use Web3 Summit features without paying blockchain
        fees on every action.
      </p>

      <!-- Spacer pins the CTA to the bottom on tall viewports without
           crowding the description on short ones. -->
      <div class="spacer" aria-hidden="true" />

      <button
        ref="activateBtnRef"
        type="button"
        class="cta"
        data-testid="festival-pass-activate"
        :disabled="isActivating || isExploding"
        @click="onActivateClick"
      >
        <span v-if="!isActivating">Activate</span>
        <span v-else class="cta-spinner" aria-label="Activating">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray="42 100"
            />
          </svg>
        </span>
      </button>
    </div>
  </Teleport>
</template>

<script lang="ts">
// Module-scope so the layout is computed once. Do not introduce randomness here.
type Particle = {
  id: number
  /** initial x as % of card-area width (source coords in the 370×186 frame) */
  xPct: number
  /** initial y as % of card-area height */
  yPct: number
  size: number
  /** outward drift vector in px */
  dx: number
  dy: number
  /** start delay so the field doesn't pulse in unison */
  delay: number
  /** converge-to-center delta in px, against the 370×186 reference */
  cx: number
  cy: number
}

const CARD_W = 370
const CARD_H = 186
const CENTER_X = CARD_W / 2
const CENTER_Y = CARD_H / 2

function makeParticle(id: number, x: number, y: number, size: number, dx: number, dy: number, delay: number): Particle {
  return {
    id,
    xPct: (x / CARD_W) * 100,
    yPct: (y / CARD_H) * 100,
    size,
    dx,
    dy,
    delay,
    cx: CENTER_X - x - size / 2,
    cy: CENTER_Y - y - size / 2,
  }
}

// 6 particles seeded around the card edges. Source coords are in the
// 370×186 design frame; makeParticle converts them to percentages.
const particles: Particle[] = [
  makeParticle(1, 12, -56, 16, -32, -28, 0),
  makeParticle(2, 24, -54, 16, -10, -36, 220),
  makeParticle(3, 200, -68, 8, 0, -40, 80),
  makeParticle(4, 354, -54, 16, 36, -22, 160),
  makeParticle(5, 366, -54, 8, 30, -30, 320),
  makeParticle(6, 269, -22, 8, 18, -42, 60),
]
</script>

<style scoped>
.festival-pass {
  font-family: var(--font-body, 'Inter', sans-serif);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding-top: calc(var(--safe-top, 0px) + 56px);
  padding-bottom: calc(var(--safe-bottom, 0px) + 24px);
}

.title {
  flex: 0 0 auto;
  margin: 0 16px;
  text-align: center;
  font-size: 32px;
  line-height: 38px;
  font-weight: 600;
  letter-spacing: 0;
}

/* Caps at 370px, shrinks below on narrow viewports. */
.card-area {
  position: relative;
  margin: 56px auto 0;
  width: min(370px, calc(100% - 32px));
  aspect-ratio: 370 / 186;
  pointer-events: none;
  flex: 0 0 auto;
}

.card {
  position: relative;
  z-index: 3;
  width: 100%;
  height: auto;
  display: block;
  transform-origin: center;
  transition: transform 0s;
}
.card-area.is-exploding .card {
  animation: card-explode 500ms cubic-bezier(0.4, 0, 0.6, 1) forwards;
  animation-delay: 550ms;
}
@keyframes card-explode {
  0%   { transform: scale(1)   rotate(0deg);  opacity: 1; }
  40%  { transform: scale(1.15) rotate(-2deg); opacity: 1; }
  100% { transform: scale(0)   rotate(8deg);  opacity: 0; }
}

.card-label {
  position: absolute;
  top: 56px;
  left: 0;
  right: 0;
  z-index: 4;
  text-align: center;
  color: black;
  pointer-events: none;
}
.card-label-sup {
  font-size: 16px;
  font-weight: 500;
  letter-spacing: 0.04em;
  margin: 0 0 4px 0;
}
.card-label-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
}

.particle {
  position: absolute;
  border-radius: 2px;
  z-index: 2;
  opacity: 0;
  animation: float-out 2.4s ease-out infinite;
}
@keyframes float-out {
  0%   { opacity: 0;   transform: translate(0, 0) scale(0.8); }
  20%  { opacity: 0.95; }
  70%  { opacity: 0.6; }
  100% { opacity: 0;   transform: translate(var(--dx, 0), var(--dy, 0)) scale(1); }
}
.card-area.is-exploding .particle {
  animation: converge 600ms cubic-bezier(0.5, 0, 0.5, 1) forwards;
}
@keyframes converge {
  0%   { opacity: 0.9; transform: translate(0, 0) scale(1); }
  60%  { opacity: 1; }
  100% { opacity: 0;   transform: translate(var(--cx, 0), var(--cy, 0)) scale(0.25); }
}

.description {
  flex: 0 0 auto;
  margin: 24px 32px 0;
  text-align: center;
  font-size: 16px;
  line-height: 22px;
  color: rgba(255, 255, 255, 0.69);
}

.spacer {
  flex: 1 1 auto;
  min-height: 24px;
}

.cta {
  flex: 0 0 auto;
  margin: 0 24px;
  height: 56px;
  border-radius: 16px;
  background: #ffffff;
  color: #000000;
  border: none;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 150ms ease, opacity 150ms ease;
}
.cta:disabled {
  cursor: progress;
  opacity: 0.7;
}
.cta:not(:disabled):hover {
  background: #f3f3f2;
}
.cta-spinner svg {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .particle,
  .card-area.is-exploding .particle,
  .card-area.is-exploding .card {
    animation-duration: 1ms;
    animation-iteration-count: 1;
  }
}
</style>
