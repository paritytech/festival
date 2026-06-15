<script setup lang="ts">
import { computed } from 'vue'
import { useSubEvents } from '~/composables/useSubEvents'
import { useHiddenSessions } from '~/composables/useHiddenSessions'
import { useWalletStore } from '@festival/shared/host/wallet'
import { ss58ToH160, isValidEvmAddress } from '@festival/shared/utils/address'
import { formatTimeBerlin } from '@festival/shared/utils/time'

const { subEvents } = useSubEvents()
const { isHidden } = useHiddenSessions()
const wallet = useWalletStore()

const userH160 = computed(() => {
  if (!wallet.isConnected) return null
  return isValidEvmAddress(wallet.address)
    ? wallet.address.toLowerCase()
    : ss58ToH160(wallet.address).toLowerCase()
})

const visibleSubEvents = computed(() => subEvents.value.filter(se => !isHidden(se.address)))

const mySubEvents = computed(() =>
  visibleSubEvents.value.filter(se => userH160.value && se.creator.toLowerCase() === userH160.value),
)

const otherSubEvents = computed(() =>
  visibleSubEvents.value.filter(se => !userH160.value || se.creator.toLowerCase() !== userH160.value),
)

function formatTime(ts: number) {
  return formatTimeBerlin(new Date(ts * 1000))
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-heading text-2xl font-bold">Sessions</h2>
      <NuxtLink
        to="/sub-events/create"
        class="px-4 py-2.5 bg-primary text-text-and-icons-primary rounded-md text-sm hover:bg-primary-hover transition-colors"
      >
        Create
      </NuxtLink>
    </div>

    <div v-if="!visibleSubEvents.length" class="bg-surface border border-border rounded-md p-8 text-center">
      <p class="text-2xl mb-3">🎪</p>
      <p class="text-text-muted text-sm">No sessions yet.</p>
    </div>

    <div v-else class="space-y-4">
      <!-- User's sub-events (pinned) -->
      <div v-if="mySubEvents.length">
        <p class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Yours</p>
        <div class="space-y-3">
          <div
            v-for="se in mySubEvents"
            :key="se.address"
            class="bg-surface border border-primary/20 rounded-md p-4"
          >
            <NuxtLink :to="`/sub-events/${se.address}`" class="flex items-start gap-3">
              <div
                v-if="se.metadata.badgePixels"
                class="w-12 h-12 rounded overflow-hidden border border-border-light shrink-0"
              >
                <BadgeCanvas :pixels="se.metadata.badgePixels" :size="48" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm">{{ se.metadata.name }}</h3>
                <p class="text-xs text-text-muted mt-0.5">
                  {{ formatTime(se.startTime) }}–{{ formatTime(se.endTime) }}
                </p>
                <p class="text-xs text-text-secondary mt-1 line-clamp-1">{{ se.metadata.description }}</p>
                <div class="flex items-center gap-3 mt-2">
                  <span class="text-xs text-text-muted">{{ se.registeredCount }}/{{ se.capacity || '∞' }}</span>
                  <span
                    v-if="se.isRegistered"
                    class="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium"
                  >
                    Registered
                  </span>
                </div>
              </div>
            </NuxtLink>
            <NuxtLink
              :to="`/my/manage/${se.address}`"
              class="block mt-3 px-3 py-2 bg-surface-elevated border border-border rounded-md text-xs text-center hover:bg-background transition-colors"
            >
              Manage
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Other sub-events -->
      <div v-if="otherSubEvents.length">
        <p v-if="mySubEvents.length" class="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">All</p>
        <div class="space-y-3">
          <NuxtLink
            v-for="se in otherSubEvents"
            :key="se.address"
            :to="`/sub-events/${se.address}`"
            class="bg-surface border border-border rounded-md p-4 block hover:bg-surface-elevated transition-colors"
          >
            <div class="flex items-start gap-3">
              <div
                v-if="se.metadata.badgePixels"
                class="w-12 h-12 rounded overflow-hidden border border-border-light shrink-0"
              >
                <BadgeCanvas :pixels="se.metadata.badgePixels" :size="48" />
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm">{{ se.metadata.name }}</h3>
                <p class="text-xs text-text-muted mt-0.5">
                  {{ formatTime(se.startTime) }}–{{ formatTime(se.endTime) }}
                </p>
                <p class="text-xs text-text-secondary mt-1 line-clamp-1">{{ se.metadata.description }}</p>
                <div class="flex items-center gap-3 mt-2">
                  <span class="text-xs text-text-muted">{{ se.registeredCount }}/{{ se.capacity || '∞' }}</span>
                  <span
                    v-if="se.isRegistered"
                    class="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium"
                  >
                    Registered
                  </span>
                </div>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
