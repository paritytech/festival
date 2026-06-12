import { computed } from 'vue'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { MOCK_VENUE_MAP } from '@festival/shared/mocks'
import { DEFAULT_ZONES } from '@festival/shared/venue/zones'
import { useFestival } from './useFestival'

/** Markers + zones for the active festival. Falls back to MOCK_VENUE_MAP /
 *  DEFAULT_ZONES in undeployed builds so dev surfaces always have something
 *  to render. Surfaces that must hide the venue map without deployed data
 *  (e.g. the check-in screen) should read `metadata.value?.venueMap?` directly
 *  instead of using this composable. */
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
