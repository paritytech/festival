<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  badgePixels: number[] | null
  sessionName: string
  receivedLabel: string
}>()

defineEmits<{ dismiss: [] }>()

const isWhite = ref(false)
const isRevealed = ref(false)
const isSpinning = ref(false)

const burstStart = ref(false)
const burst1 = ref(false)
const burst2 = ref(false)
const burst3 = ref(false)

const timers: ReturnType<typeof setTimeout>[] = []
function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

onMounted(() => {
  // Phase 1. Start the badge spin (3600ms total, 4 full rotations)
  at(0, () => { isSpinning.value = true })

  // Phase 2. Three stars burst sequentially (offsets 0/600/1200ms within burst phase)
  at(1000, () => {
    burstStart.value = true
    at(0, () => { burst1.value = true })
    at(600, () => { burst2.value = true })
    at(1200, () => { burst3.value = true })
  })

  // Phase 3. White overlay fades in
  at(3400, () => { isWhite.value = true })

  // Phase 4: "Back to Session" button reveals
  at(4200, () => { isRevealed.value = true })
})

onUnmounted(() => {
  timers.forEach(clearTimeout)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="badge-earned fixed inset-0 md:left-[var(--col-l)] md:right-[var(--col-r)] z-[2100] overflow-hidden bg-black"
      :class="{ 'is-white': isWhite, 'is-revealed': isRevealed }"
      data-testid="badge-earned-screen"
      role="dialog"
      aria-modal="true"
    >
      <!-- Title -->
      <h1 class="title">You've earned<br />a badge!</h1>

      <!-- Stars layer -->
      <div v-if="burstStart" class="stars">
        <div class="star star-1" :class="{ 'is-bursting': burst1 }">
          <svg viewBox="0 0 498 506" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M-3.38498e-07 127.837L198.916 188.243L287.126 0.000458605L291.145 207.847L497.432 233.57L301.001 301.62L340.283 505.76L214.863 339.971L32.8531 440.414L151.771 269.9L-3.38498e-07 127.837Z"
              fill="#FF7700"
            />
          </svg>
        </div>
        <div class="star star-2 is-mid" :class="{ 'is-bursting': burst2 }">
          <svg viewBox="0 0 335 335" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M301.402 32.7049L242.743 147.83L334.107 239.194L206.489 218.982L147.83 334.107L127.617 206.489L-2.84458e-06 186.277L115.125 127.618L94.9127 0.000169247L186.277 91.3642L301.402 32.7049Z"
              fill="#FFFFFF"
            />
          </svg>
        </div>
        <div class="star star-3 is-last" :class="{ 'is-bursting': burst3 }">
          <svg viewBox="0 0 335 335" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M301.402 32.7049L242.743 147.83L334.107 239.194L206.489 218.982L147.83 334.107L127.617 206.489L-2.84458e-06 186.277L115.125 127.618L94.9127 0.000169247L186.277 91.3642L301.402 32.7049Z"
              fill="#FFFFFF"
            />
          </svg>
        </div>
      </div>

      <!-- White flash overlay -->
      <div class="white-overlay" />

      <!-- Badge -->
      <div class="badge-wrap">
        <div class="badge" :class="{ 'is-spinning': isSpinning }">
          <div class="badge-front">
            <BadgeCanvas
              v-if="props.badgePixels"
              :pixels="props.badgePixels"
              :size="200"
            />
            <div v-else class="w-full h-full bg-surface" />
          </div>
        </div>
      </div>

      <!-- Label -->
      <div class="label">
        <div class="name">{{ props.sessionName }}</div>
        <div class="received">Received: {{ props.receivedLabel }}</div>
      </div>

      <!-- Back to Session button -->
      <button
        class="back-button"
        data-testid="badge-earned-back"
        @click="$emit('dismiss')"
      >
        Back to Session
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.badge-earned { font-family: inherit; }

/* Title. Sits above the badge, mix-blend-mode keeps it visible against both dark and white */
.title {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 80px);
  left: 0;
  right: 0;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
  z-index: 30;
  mix-blend-mode: difference;
  margin: 0;
}

/* Stars layer. Centered, stars overflow this 200×200 box */
.stars {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  pointer-events: none;
  z-index: 1;
}
.star {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200px;
  height: 200px;
  transform: translate(-50%, -50%) scale(0) rotate(var(--rot, 0deg));
  transform-origin: center;
  will-change: transform;
}
.star svg { width: 100%; height: 100%; display: block; }

.star-1 { --rot: 0deg; }
.star-2 { --rot: 120deg; }
.star-3 { --rot: 240deg; }

.star.is-bursting {
  animation: burst 1200ms cubic-bezier(0.33, 1, 0.68, 1) forwards;
}
.star.is-mid.is-bursting {
  animation: burst-mid 1200ms cubic-bezier(0.33, 1, 0.68, 1) forwards;
}
.star.is-last.is-bursting {
  animation: burst-last 1200ms cubic-bezier(0.33, 1, 0.68, 1) forwards;
}

@keyframes burst {
  0%   { transform: translate(-50%, -50%) scale(0)  rotate(var(--rot, 0deg)); }
  6%   { transform: translate(-50%, -50%) scale(0.3) rotate(calc(var(--rot, 0deg) + 30deg)); }
  35%  { transform: translate(-50%, -50%) scale(2)  rotate(calc(var(--rot, 0deg) + 120deg)); }
  70%  { transform: translate(-50%, -50%) scale(5)  rotate(calc(var(--rot, 0deg) + 270deg)); }
  100% { transform: translate(-50%, -50%) scale(10) rotate(calc(var(--rot, 0deg) + 360deg)); }
}
@keyframes burst-mid {
  0%   { transform: translate(-50%, -50%) scale(0)  rotate(var(--rot, 0deg)); }
  6%   { transform: translate(-50%, -50%) scale(0.3) rotate(calc(var(--rot, 0deg) + 30deg)); }
  35%  { transform: translate(-50%, -50%) scale(2)  rotate(calc(var(--rot, 0deg) + 120deg)); }
  70%  { transform: translate(-50%, -50%) scale(5)  rotate(calc(var(--rot, 0deg) + 270deg)); }
  85%  { transform: translate(-50%, -50%) scale(8)  rotate(calc(var(--rot, 0deg) + 340deg)); }
  100% { transform: translate(-50%, -50%) scale(15) rotate(calc(var(--rot, 0deg) + 360deg)); }
}
@keyframes burst-last {
  0%   { transform: translate(-50%, -50%) scale(0)  rotate(var(--rot, 0deg)); }
  6%   { transform: translate(-50%, -50%) scale(0.3) rotate(calc(var(--rot, 0deg) + 30deg)); }
  35%  { transform: translate(-50%, -50%) scale(2)  rotate(calc(var(--rot, 0deg) + 120deg)); }
  70%  { transform: translate(-50%, -50%) scale(5)  rotate(calc(var(--rot, 0deg) + 270deg)); }
  85%  { transform: translate(-50%, -50%) scale(10) rotate(calc(var(--rot, 0deg) + 340deg)); }
  100% { transform: translate(-50%, -50%) scale(20) rotate(calc(var(--rot, 0deg) + 360deg)); }
}

/* White overlay. Covers entire screen when active */
.white-overlay {
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  z-index: 3;
  pointer-events: none;
  transition: opacity 500ms ease-out;
}
.badge-earned.is-white .white-overlay { opacity: 1; }

/* Badge: 3D spin */
.badge-wrap {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  perspective: 800px;
  z-index: 5;
}
.badge {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  will-change: transform;
}
.badge.is-spinning {
  animation: spin-buildup 3600ms cubic-bezier(0.55, 0, 0.3, 1) forwards;
}
@keyframes spin-buildup {
  from { transform: rotateY(0deg); }
  to   { transform: rotateY(1440deg); }
}
.badge-front {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

/* Label. Session name + received timestamp */
.label {
  position: absolute;
  bottom: 220px;
  left: 0;
  right: 0;
  text-align: center;
  z-index: 30;
  color: #fff;
  mix-blend-mode: difference;
}
.label .name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
.label .received {
  font-size: 13px;
  opacity: 0.55;
  font-weight: 400;
}

/* Back to Session button */
.back-button {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + 32px);
  left: 24px;
  right: 24px;
  height: 56px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  z-index: 30;
  background: #000;
  color: #fff;
  border: none;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 800ms ease, transform 800ms cubic-bezier(0.16, 1, 0.3, 1);
}
.badge-earned.is-revealed .back-button {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .badge.is-spinning,
  .star.is-bursting,
  .star.is-mid.is-bursting,
  .star.is-last.is-bursting {
    animation-duration: 1ms;
    animation-iteration-count: 1;
  }
  .white-overlay { transition-duration: 1ms; }
  .back-button { transition-duration: 1ms; }
}
</style>
