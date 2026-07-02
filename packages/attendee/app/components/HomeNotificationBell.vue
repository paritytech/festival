<script setup lang="ts">
import { computed } from 'vue'
import { useAnnouncements } from '~/composables/useAnnouncements'

// Header bell that opens the announcements inbox (/my/notifications, which
// marks the channel read on view so the unread dot clears reactively). Gated
// on check-in by the caller.
const router = useRouter()
const { unreadCount, loadChannel } = useAnnouncements()

void loadChannel()

const hasUnread = computed(() => unreadCount.value > 0)

const ariaLabel = computed(() =>
  hasUnread.value
    ? `Notifications, ${unreadCount.value} unread`
    : 'Notifications',
)

function openInbox() {
  router.push('/my/notifications')
}
</script>

<template>
  <IconButton
    shape="square"
    class="relative -mr-1"
    data-testid="notifications-bell"
    :aria-label="ariaLabel"
    @click="openInbox"
  >
    <img src="/bell-quiet.svg" alt="" width="24" height="24" class="shrink-0" />
    <!-- Unread indicator: red dot ringed in the page background so it stays
         legible on both dark and light themes. -->
    <span
      v-if="hasUnread"
      class="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-bg-status-error ring-2 ring-background"
      data-testid="notifications-bell-dot"
    />
  </IconButton>
</template>
