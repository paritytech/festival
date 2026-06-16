<script setup lang="ts">
defineProps<{
  kind: 'ongoing' | 'soon'
  source: 'program' | 'community' | 'activations'
  title: string
  minutes?: number
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    type="button"
    class="session-strip"
    :class="`session-strip--${source}`"
    data-testid="map-session-strip"
    @click="$emit('click')"
  >
    <span class="session-strip__accent" aria-hidden="true" />
    <span class="session-strip__body">
      <span
        class="session-strip__label"
        :class="{ 'session-strip__label--ongoing': kind === 'ongoing' }"
      >
        <span v-if="kind === 'ongoing'" class="session-strip__dot" aria-hidden="true" />
        {{ kind === 'ongoing' ? 'Ongoing' : `In ${minutes ?? 0} min` }}
      </span>
      <span class="session-strip__title">{{ title }}</span>
    </span>
  </button>
</template>

<style scoped>
/* Black card inset inside the white selected-location card. */
.session-strip {
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  background: #0f0f0f;
  color: #ffffff;
  border: 0;
  border-radius: 16px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.session-strip:hover { background: #161616; }
.session-strip:active { background: #1d1d1d; }

/* Left accent bar. White for program entries, purple for community sessions,
   gold for activations. */
.session-strip__accent {
  flex: none;
  width: 3px;
  border-radius: 2px;
  margin: 2px 0;
}
.session-strip--program .session-strip__accent { background: #fafaf9; }
.session-strip--community .session-strip__accent { background: #9462fa; }
.session-strip--activations .session-strip__accent { background: #FFB300; }

.session-strip__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.session-strip__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}
.session-strip__label--ongoing { color: #ff4031; }
.session-strip__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff4031;
}
.session-strip__title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
