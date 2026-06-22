import { ref, reactive } from 'vue'
import type { FestivalMetadata, ChannelMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { compressImage } from '@festival/shared/metadata/image'
import { berlinFormToUnix } from '@festival/shared/utils/time'

export interface CreateFormState {
  // Step 1: Basic info
  name: string
  description: string
  organizer: string
  website: string
  tags: string
  // Step 2: Location
  venueName: string
  venueAddress: string
  // Step 3: Dates
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  // Step 4: Capacity
  capacity: number
}

const defaultForm: CreateFormState = {
  name: '',
  description: '',
  organizer: '',
  website: '',
  tags: '',
  venueName: '',
  venueAddress: '',
  startDate: '',
  startTime: '09:00',
  endDate: '',
  endTime: '18:00',
  capacity: 0,
}

export function useFestivalCreate() {
  const step = ref(1)
  const totalSteps = 6
  const form = reactive<CreateFormState>({ ...defaultForm })
  const festivalPoapImage = ref<File | null>(null)
  const festivalPoapImagePreview = ref<string>('')
  const txStatus = ref<TxStatus>('idle')
  const error = ref<string | null>(null)
  const createdAddress = ref<string | null>(null)

  function setFestivalPoapImage(file: File | null) {
    festivalPoapImage.value = file
    if (festivalPoapImagePreview.value) URL.revokeObjectURL(festivalPoapImagePreview.value)
    festivalPoapImagePreview.value = file ? URL.createObjectURL(file) : ''
  }

  function nextStep() {
    if (step.value < totalSteps) step.value++
  }

  function prevStep() {
    if (step.value > 1) step.value--
  }

  function goToStep(n: number) {
    if (n >= 1 && n <= totalSteps) step.value = n
  }

  function getStartTimestamp(): number {
    return berlinFormToUnix(form.startDate, form.startTime)
  }

  function getEndTimestamp(): number {
    return berlinFormToUnix(form.endDate, form.endTime)
  }

  function buildMetadata(): FestivalMetadata {
    return {
      version: '1.0',
      type: 'festival',
      name: form.name,
      description: form.description,
      location: {
        venue: form.venueName,
        address: form.venueAddress,
      },
      image: '',
      website: form.website || undefined,
      organizer: form.organizer,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      schedule: [],
    }
  }

  async function submit() {
    error.value = null
    txStatus.value = 'preparing'

    try {
      const metadata = buildMetadata()
      const { storePlaintext, storeImage } = useBulletinStorage()

      if (festivalPoapImage.value) {
        const compressed = await compressImage(festivalPoapImage.value)
        const { cid: poapImageCid } = await storeImage(compressed)
        metadata.festivalPoapImage = poapImageCid
      }
      const { bytes32: metadataCid } = await storePlaintext(metadata)

      // Empty channel doc so the announcement channel is registered atomically
      // in setup() alongside the metadata CID.
      const channel: ChannelMetadata = {
        createdAt: Date.now(),
        announcements: [],
      }
      const { bytes32: channelMetadataCid } = await storePlaintext(channel)

      const wallet = useWalletStore()

      await writeContract({
        address: FESTIVAL_ADDRESS as `0x${string}`,
        abi: FestivalABI,
        functionName: 'setup',
        args: [
          metadataCid,
          channelMetadataCid,
          BigInt(getStartTimestamp()),
          BigInt(getEndTimestamp()),
          form.capacity,
        ],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => { txStatus.value = s },
      })

      createdAddress.value = FESTIVAL_ADDRESS
    } catch (e: any) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  function reset() {
    Object.assign(form, defaultForm)
    setFestivalPoapImage(null)
    step.value = 1
    txStatus.value = 'idle'
    error.value = null
    createdAddress.value = null
  }

  return {
    step,
    totalSteps,
    form,
    festivalPoapImage,
    festivalPoapImagePreview,
    setFestivalPoapImage,
    txStatus,
    error,
    createdAddress,
    nextStep,
    prevStep,
    goToStep,
    submit,
    reset,
  }
}
