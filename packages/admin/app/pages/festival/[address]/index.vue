<script setup lang="ts">
import { ref, computed } from 'vue'
import IconEdit from '~icons/ic/round-edit'
import { useFestival } from '~/composables/useFestival'
import { useFestivalContext } from '~/composables/useFestivalContext'
import { usePermissions } from '~/composables/usePermissions'
import { formatTimestamp } from '@festival/shared/utils/time'
import { isNonZeroCid } from '@festival/shared/contracts/festival-reads'

definePageMeta({ layout: 'festival' })

const route = useRoute()
const address = route.params.address as string
const { metadata, details, checkedInCount, sessionCount, status, isLoading, reload } = useFestival(address)
const { draft, userRoles } = useFestivalContext()
const { canEditMetadata } = usePermissions(userRoles)

const editing = ref(false)

const hasNonZeroCid = computed(() =>
  details.value?.metadataCid ? isNonZeroCid(details.value.metadataCid) : false,
)

const statusStyles: Record<string, string> = {
  upcoming: 'bg-violet/12 text-violet',
  active: 'bg-success/12 text-success',
  ended: 'bg-surface-2 text-text-muted',
  cancelled: 'bg-danger/12 text-danger',
}
</script>

<template>
  <div v-if="isLoading" class="text-center py-12 text-text-muted">Loading…</div>

  <div v-else-if="!metadata && details" class="space-y-6">
    <!-- setup() not called yet (metadataCid is zero) -->
    <div v-if="!hasNonZeroCid" class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-2">Festival not configured</h3>
      <p class="text-sm text-text-secondary mb-4">
        This contract is deployed but hasn't been set up yet. Configure the festival name, dates, capacity, and other details to get started.
      </p>
      <NuxtLink
        to="/create"
        class="inline-block px-4 py-2 bg-primary text-black rounded-2xl text-sm font-medium hover:bg-primary-hover transition-colors"
      >
        Set Up Festival
      </NuxtLink>
    </div>

    <!-- setup() was called but metadata not yet available from IPFS -->
    <div v-else class="bg-violet/12 rounded-xl p-5">
      <h3 class="font-medium mb-2 text-violet">Metadata is being indexed</h3>
      <p class="text-sm text-violet mb-4">
        The festival is configured on-chain but the metadata hasn't propagated to IPFS yet. This usually takes a few minutes.
      </p>
      <button
        class="px-4 py-2 bg-primary text-black rounded-2xl text-sm font-medium hover:bg-primary-hover transition-colors"
        @click="reload()"
      >
        Retry
      </button>
    </div>

    <!-- On-chain details (shown in both cases) -->
    <div class="bg-surface rounded-xl p-5">
      <h3 class="font-medium mb-3 text-sm text-text-muted">On-chain details</h3>
      <div class="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6 text-sm">
        <div>
          <p class="text-text-muted text-xs">Contract</p>
          <p class="font-mono text-xs break-all">{{ address }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Creator</p>
          <p class="font-mono text-xs break-all">{{ details.creator }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Sessions</p>
          <p>{{ details.sessionsEnabled ? 'Enabled' : 'Disabled' }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Registered</p>
          <p>{{ details.registeredCount }}</p>
        </div>
        <div v-if="details.startTime > 0n">
          <p class="text-text-muted text-xs">Start</p>
          <p>{{ formatTimestamp(Number(details.startTime)) }}</p>
        </div>
        <div v-if="details.endTime > 0n">
          <p class="text-text-muted text-xs">End</p>
          <p>{{ formatTimestamp(Number(details.endTime)) }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Capacity</p>
          <p>{{ details.capacity || 'Unlimited' }}</p>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="metadata">
    <div class="mb-6">
      <div class="flex items-center gap-3 mb-1">
        <h2 class="font-heading text-2xl font-bold min-w-0 break-words" data-testid="festival-name">{{ draft.name || metadata.name || 'Untitled Festival' }}</h2>
        <span
          class="text-xs px-2.5 py-1 rounded-full font-medium shrink-0 capitalize whitespace-nowrap"
          :class="statusStyles[status] || 'bg-surface-2'"
          data-testid="festival-status-badge"
        >
          {{ status }}
        </span>
      </div>
      <p class="text-text-secondary text-sm">{{ draft.description || metadata.description }}</p>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-surface rounded-xl p-4" data-testid="stat-registered">
        <p class="text-2xl font-bold">{{ details.registeredCount }}</p>
        <p class="text-xs text-text-muted">Registered</p>
      </div>
      <div class="bg-surface rounded-xl p-4" data-testid="stat-checked-in">
        <p class="text-2xl font-bold">{{ checkedInCount }}</p>
        <p class="text-xs text-text-muted">Checked In</p>
      </div>
      <div class="bg-surface rounded-xl p-4" data-testid="stat-capacity">
        <p class="text-2xl font-bold">{{ details.capacity || '∞' }}</p>
        <p class="text-xs text-text-muted">Capacity</p>
      </div>
      <div class="bg-surface rounded-xl p-4" data-testid="stat-sessions">
        <p class="text-2xl font-bold">{{ details.sessionsEnabled ? sessionCount : 'Off' }}</p>
        <p class="text-xs text-text-muted">Sessions</p>
      </div>
    </div>

    <!-- Details -->
    <div class="bg-surface rounded-xl p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-medium">Details</h3>
        <button
          v-if="canEditMetadata"
          class="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
          @click="editing = !editing"
        >
          <IconEdit class="w-3.5 h-3.5" />
          {{ editing ? 'Done' : 'Edit' }}
        </button>
      </div>

      <!-- Edit mode -->
      <div v-if="editing" class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs text-text-muted mb-1">Festival Name</label>
            <input v-model="draft.name" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Web3 Summit 2026" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">Organizer</label>
            <input v-model="draft.organizer" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Organization name" />
          </div>
        </div>
        <div>
          <label class="block text-xs text-text-muted mb-1">Description</label>
          <textarea v-model="draft.description" rows="2" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary resize-none" placeholder="Describe the festival…" />
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs text-text-muted mb-1">Venue</label>
            <input v-model="draft.location.venue" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Funkhaus Berlin" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">Address</label>
            <input v-model="draft.location.address" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Nalepastraße 18, 12459 Berlin" />
          </div>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-xs text-text-muted mb-1">Website</label>
            <input v-model="draft.website" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="https://…" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">Tags</label>
            <input
              :value="draft.tags?.join(', ') || ''"
              type="text"
              class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary"
              placeholder="web3, polkadot (comma separated)"
              @change="draft.tags = ($event.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean)"
            />
          </div>
        </div>
        <p class="text-xs text-text-muted">Changes publish from the sidebar.</p>
      </div>

      <!-- Read-only mode -->
      <div v-else class="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6 text-sm">
        <div>
          <p class="text-text-muted text-xs">Organizer</p>
          <p>{{ draft.organizer || '—' }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Venue</p>
          <p>{{ draft.location.venue || '—' }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">Start</p>
          <p>{{ formatTimestamp(Number(details.startTime)) }}</p>
        </div>
        <div>
          <p class="text-text-muted text-xs">End</p>
          <p>{{ formatTimestamp(Number(details.endTime)) }}</p>
        </div>
        <div class="sm:col-span-2">
          <p class="text-text-muted text-xs">Contract Address</p>
          <p class="font-mono text-xs break-all">{{ address }}</p>
        </div>
        <div v-if="draft.tags?.length">
          <p class="text-text-muted text-xs">Tags</p>
          <div class="flex flex-wrap gap-1 mt-0.5">
            <span
              v-for="tag in draft.tags"
              :key="tag"
              class="text-[10px] px-1.5 py-0.5 bg-background rounded"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
