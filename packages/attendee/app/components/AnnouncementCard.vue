<script setup lang="ts">
import { computed } from 'vue'
import { useAnnouncements } from '~/composables/useAnnouncements'

const props = defineProps<{ cid: string; highlight?: boolean }>()

const { bodies } = useAnnouncements()

// Map state: key absent = still being fetched by ensureBodies; value === null
// = fetch failed; value present = loaded. Render three states accordingly.
const entry = computed(() => bodies.value.get(props.cid))
const loading = computed(() => !bodies.value.has(props.cid))
const body = computed(() => entry.value ?? null)

function formatTimestamp(ts: number) {
  const d = new Date(ts)
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleString('en-GB', { month: 'short' })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${day} ${month} at ${time}`
}
</script>

<template>
  <div
    class="rounded-2xl p-4 flex items-start gap-3 transition-colors"
    :class="props.highlight ? 'bg-bg-surface-nested' : 'bg-bg-surface-nested'"
  >
    <img
      src="/announcement-icon.svg"
      alt=""
      width="24"
      height="24"
      class="shrink-0 mt-0.5"
      aria-hidden="true"
    />

    <div class="flex-1 min-w-0">
      <!-- Renders even while the body is loading, so the unread bullet
           appears immediately for a freshly-arrived announcement. -->
      <div class="flex items-center gap-1.5 text-sm text-text-and-icons-tertiary">
        <span
          v-if="props.highlight"
          class="w-1.5 h-1.5 rounded-full bg-bg-status-error shrink-0"
          aria-label="Unread"
        />
        <span v-if="body">{{ formatTimestamp(body.timestamp) }}</span>
        <span v-else-if="loading" class="h-3 bg-bg-action-secondary rounded animate-pulse w-28" />
      </div>
      <p v-if="body" class="text-base text-text-and-icons-primary whitespace-pre-wrap break-words leading-snug">
        {{ body.content }}
      </p>
      <div v-else-if="loading" class="space-y-2 mt-2">
        <div class="h-3 bg-bg-action-secondary rounded animate-pulse w-3/4" />
        <div class="h-3 bg-bg-action-secondary rounded animate-pulse w-1/2" />
      </div>
      <p v-else class="text-xs text-text-and-icons-tertiary">Couldn't load announcement.</p>
      <p v-if="body?.senderName" class="text-xs text-text-and-icons-tertiary mt-2">
        {{ body.senderName }}
      </p>
    </div>
  </div>
</template>
