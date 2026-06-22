<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useFestival } from '~/composables/useFestival'
import { useSubEvents } from '~/composables/useSubEvents'
import type { TxStatus } from '@festival/shared/contracts/write'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import { randomAnonymousSpeakerName } from '@festival/shared/metadata/anonymousSpeaker'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { formatTxError } from '@festival/shared/contracts/errors'
import { timestampToInputBounds, berlinFormToUnix } from '@festival/shared/utils/time'

definePageMeta({ layout: 'festival' })

const route = useRoute()
const address = route.params.address as string
const { details: festivalDetails, metadata: festivalMetadata } = useFestival(address)
const { createSession } = useSubEvents(address)

const festivalBounds = computed(() => {
  if (!festivalDetails.value || festivalDetails.value.startTime === 0n) return null
  return {
    start: timestampToInputBounds(festivalDetails.value.startTime),
    end: timestampToInputBounds(festivalDetails.value.endTime),
  }
})

const venueMarkers = computed(() => festivalMetadata.value?.venueMap?.markers ?? [])

const form = reactive({
  name: '',
  description: '',
  speakers: '',
  startDate: '',
  startTime: '10:00',
  endDate: '',
  endTime: '11:00',
  venueMarkerId: '',
})

const badgeHex = ref('')
const txStatus = ref<TxStatus>('idle')
const error = ref<string | null>(null)
const createdAddress = ref<string | null>(null)

function buildMetadata(): SubEventMetadata {
  const enteredSpeakers = form.speakers.split(',').map(s => s.trim()).filter(Boolean)
  return {
    version: '1.0',
    type: 'sub-event',
    name: form.name,
    description: form.description,
    location: form.venueMarkerId,
    speakers: enteredSpeakers.length ? enteredSpeakers : [randomAnonymousSpeakerName()],
    badgeHex: badgeHex.value || undefined,
  }
}

async function submit() {
  if (!form.name || !form.startDate || !form.endDate) return
  error.value = null
  txStatus.value = 'preparing'
  try {
    // Store metadata on Bulletin Chain. Must succeed. Otherwise the
    // session lands on-chain with a zero CID and the agenda renders it
    // without a name or image. Surface the failure and abort.
    const metadata = buildMetadata()
    const { storePlaintext } = useBulletinStorage()
    const { bytes32 } = await storePlaintext(metadata).catch((e): never => {
      console.error('[SubEvent Create] Bulletin upload failed:', e)
      throw new Error("Couldn't save your session. Please try again.", { cause: e })
    })

    txStatus.value = 'signing'

    const startTs = BigInt(berlinFormToUnix(form.startDate, form.startTime))
    const endTs = BigInt(berlinFormToUnix(form.endDate, form.endTime))

    const addr = await createSession(bytes32, startTs, endTs, 0n, metadata)
    createdAddress.value = addr || address
  } catch (e: any) {
    txStatus.value = 'error'
    error.value = formatTxError(e)
  }
}
</script>

<template>
  <div class="max-w-2xl">
    <h2 class="font-heading text-2xl font-bold mb-6">Create Session</h2>

    <!-- Festival bounds hint -->
    <p v-if="festivalBounds" class="text-xs text-text-muted mb-6">
      Festival runs {{ festivalBounds.start.date }} to {{ festivalBounds.end.date }}. Session times must fall within this window.
    </p>

    <!-- Success -->
    <div v-if="createdAddress" class="bg-success-muted rounded-xl p-6 text-center">
      <p class="text-lg font-medium text-success mb-2">Session Created!</p>
      <NuxtLink
        :to="`/festival/${address}/sub-events`"
        class="px-4 py-2 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover inline-block"
      >
        Back to Sessions
      </NuxtLink>
    </div>

    <div v-else class="space-y-6">
      <!-- Basic Info -->
      <section class="space-y-4">
        <h3 class="font-medium">Basic Info</h3>
        <div>
          <label class="block text-sm font-medium mb-1">Name *</label>
          <input v-model="form.name" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Parachain Workshop" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Description</label>
          <textarea v-model="form.description" rows="2" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary resize-none" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Speakers</label>
          <input v-model="form.speakers" type="text" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2 focus:outline-none focus:border-primary" placeholder="Alice, Bob (comma separated)" />
        </div>
      </section>

      <!-- Time & Location -->
      <section class="space-y-4">
        <h3 class="font-medium">Time & Location</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm font-medium mb-1">Start Date</label>
            <input v-model="form.startDate" type="date" :min="festivalBounds?.start.date" :max="festivalBounds?.end.date" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Start Time</label>
            <input v-model="form.startTime" type="time" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">End Date</label>
            <input v-model="form.endDate" type="date" :min="festivalBounds?.start.date" :max="festivalBounds?.end.date" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">End Time</label>
            <input v-model="form.endTime" type="time" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Location</label>
          <select v-model="form.venueMarkerId" class="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface-2">
            <option value="">None</option>
            <option v-for="m in venueMarkers" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
      </section>

      <!-- Badge Editor -->
      <section>
        <h3 class="font-medium mb-3">Badge (16x16 pixel art)</h3>
        <BadgeEditor v-model="badgeHex" :title="form.name" />
      </section>

      <!-- Transaction progress -->
      <div v-if="txStatus !== 'idle' && txStatus !== 'error'" class="bg-surface rounded-xl p-4">
        <div class="flex items-center gap-3">
          <div v-if="txStatus !== 'finalized'" class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          <div>
            <p class="text-sm font-medium">
              {{ txStatus === 'preparing' ? 'Saving metadata to Polkadot Cloud…' : '' }}
              {{ txStatus === 'signing' ? 'Waiting for your signature…' : '' }}
              {{ txStatus === 'broadcasting' ? 'Broadcasting transaction…' : '' }}
              {{ txStatus === 'in-block' ? 'Creating session on-chain…' : '' }}
              {{ txStatus === 'finalized' ? 'Created!' : '' }}
            </p>
          </div>
        </div>
      </div>

      <div v-if="error" class="bg-danger-muted rounded-xl p-3 text-sm text-danger">
        {{ error }}
      </div>

      <!-- Submit -->
      <button
        class="w-full px-4 py-3 bg-primary text-black rounded-2xl text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
        :disabled="!form.name || (txStatus !== 'idle' && txStatus !== 'error')"
        @click="submit"
      >
        {{ txStatus === 'idle' || txStatus === 'error' ? 'Create Session' : 'Creating…' }}
      </button>
    </div>
  </div>
</template>
