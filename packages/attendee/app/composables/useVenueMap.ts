import { computed } from 'vue'
import { DEFAULT_ZONES } from '@festival/shared/venue/zones'
import { useFestival } from './useFestival'

export function useVenueMap() {
  const { metadata } = useFestival()

  const markers = computed(() => metadata.value?.venueMap?.markers ?? [])
  const zones = computed(() => metadata.value?.venueMap?.zones ?? DEFAULT_ZONES)

  return { markers, zones }
}
