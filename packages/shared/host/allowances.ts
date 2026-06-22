/**
 * PGAS balance read used as the "festival pass activated?" signal.
 *
 * Per RFC-0010, claimAllowances grants BulletinAllowance + SmartContractAllowance
 * together. Bulletin's allowance account is hard-derived from the user's root
 * key and unreachable from the SPA, so we proxy on PGAS (held directly by the
 * product account): balance > 0 ⇔ activated.
 */

import { useMainClient } from './client'

export const PGAS_ASSET_ID = 2_000_000_000

export type AllowanceState = {
  pgasGranted: boolean
  pgasBalance: bigint
}

export async function checkAllowancesOnChain(
  productAccount: string,
): Promise<AllowanceState> {
  const { api } = await useMainClient()
  const acc = await api.query.Assets.Account.getValue(
    PGAS_ASSET_ID,
    productAccount,
  )
  const pgasBalance = acc?.balance ?? 0n
  return {
    pgasBalance,
    pgasGranted: pgasBalance > 0n,
  }
}
