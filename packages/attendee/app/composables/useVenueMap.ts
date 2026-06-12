import { computed } from 'vue'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { MOCK_VENUE_MAP } from '@festival/shared/mocks'
import { DEFAULT_ZONES } from '@festival/shared/venue/zones'
import { useFestival } from './useFestival'

export function useVenueMap() {
  const { metadata } = useFestival()

  const markers = computed(() => {
    if (hasDeployedContracts() && metadata.value?.venueMap?.markers?.length) {
      return metadata.value.venueMap.markers
    }
    return MOCK_VENUE_MAP.markers
  })

  const zones = computed(() => {
    if (hasDeployedContracts() && metadata.value?.venueMap?.zones?.length) {
      return metadata.value.venueMap.zones
    }
    return DEFAULT_ZONES
  })

  return { markers, zones }
}
