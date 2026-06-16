<script setup lang="ts">
const emit = defineEmits<{
  (e: 'done'): void
}>()

function onScreenAnimationEnd(event: AnimationEvent) {
  // The fade is the only animation on the root element; bar/text animations
  // bubble up from children. Gate on target identity rather than animationName
  // — Vue scoped styles rewrite @keyframes names with the scope hash.
  if (event.target === event.currentTarget) {
    emit('done')
  }
}
</script>

<template>
  <div
    class="loading-screen"
    data-testid="loading-splash"
    @animationend="onScreenAnimationEnd"
  >
    <div class="bar" />
    <div class="summit-text">WEB3 SUMMIT</div>
  </div>
</template>

<style scoped>
/* 3.0s total: 2.7s bar-expand + 0.3s screen-fade. The horizontal sweep
 * is the dominant phase (~2.16s, linear) so the bar reads as a loading
 * bar rather than a transition. Vertical expansion is a quick snap to
 * black at the end. */

.loading-screen {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: #fff;
  z-index: 150;
  overflow: hidden;
  pointer-events: none;
  animation: screen-fade 0.3s 2.7s forwards;
}

@media (min-width: 768px) {
  .loading-screen {
    left: var(--col-l);
    right: var(--col-r);
  }
}

.bar {
  position: absolute;
  top: 50%;
  left: 0;
  background: #000;
  transform: translateY(-50%);
  width: 0;
  height: 53px;
  z-index: 2;
  animation: bar-expand 2.7s linear forwards;
}

.summit-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: "Courier New", Courier, monospace;
  font-weight: 500;
  font-size: 24px;
  letter-spacing: 0.5px;
  z-index: 3;
  mix-blend-mode: difference;
  color: #fff;
  white-space: nowrap;
  user-select: none;
  animation: text-fade 2.7s forwards;
}

/* Phase budget over 2.7s (percentages of 2.7s):
 *   0%   – 5%   :  135ms  initial hold. Text registers on white
 *   5%   – 85%  : 2160ms  horizontal sweep. Linear, reads as a loading bar
 *   85%  – 95%  :  270ms  vertical snap to fullscreen black
 *   95%  – 100% :  135ms  final breath on full black
 */
@keyframes bar-expand {
  0% {
    width: 0;
    height: 53px;
    animation-timing-function: linear;
  }
  5% {
    width: 0;
    height: 53px;
    animation-timing-function: linear;
  }
  85% {
    width: 100%;
    height: 53px;
    animation-timing-function: cubic-bezier(0.32, 0, 0.67, 0);
  }
  95% {
    width: 100%;
    height: 100%;
    animation-timing-function: linear;
  }
  100% {
    width: 100%;
    height: 100%;
  }
}

@keyframes text-fade {
  /* Stays visible across the whole horizontal sweep (the loading-bar
   * phase). Fades only once the vertical snap takes over so it doesn't
   * disappear while the bar is still progressing. */
  0%, 85% {
    opacity: 1;
  }
  95%, 100% {
    opacity: 0;
  }
}

@keyframes screen-fade {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-screen {
    animation: rm-screen-fade 0.3s 0.5s forwards;
  }
  .bar { animation: none; width: 100%; height: 100%; }
  .summit-text { animation: none; opacity: 1; }
  @keyframes rm-screen-fade {
    0% { opacity: 1; }
    100% { opacity: 0; visibility: hidden; }
  }
}
</style>
