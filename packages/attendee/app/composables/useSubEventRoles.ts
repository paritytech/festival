import { ref } from 'vue'
import type { ContractRole } from '@festival/shared/permissions'
import { loadUserRoles } from '@festival/shared/contracts/role-helpers'

/**
 * Reactive wrapper around shared loadUserRoles() for a specific sub-event contract.
 * Sub-event roles are independent. Not inherited from the parent festival.
 */
export function useSubEventRoles(subEventAddress: string) {
  const roles = ref<ContractRole[]>([])
  const isLoading = ref(true)

  async function load() {
    isLoading.value = true
    try {
      roles.value = await loadUserRoles(subEventAddress as `0x${string}`)
    } catch (e) {
      console.error('[useSubEventRoles] Error:', e)
      roles.value = []
    } finally {
      isLoading.value = false
    }
  }

  load()

  return { roles, isLoading, reload: load }
}
