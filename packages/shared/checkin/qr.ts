import type { CheckInPayload } from './sign'
import { isValidSs58, isValidEvmAddress } from '../utils/address'

// ── Check-In QR ──

export interface CheckInQRData {
  type: 'check-in'
  payload: CheckInPayload
  signature: string
}

export function encodeCheckInQR(payload: CheckInPayload, signature: string): string {
  const data: CheckInQRData = { type: 'check-in', payload, signature }
  return JSON.stringify(data)
}

export function decodeCheckInQR(qrData: string): CheckInQRData {
  const parsed = JSON.parse(qrData)
  if (parsed.type !== 'check-in' || !parsed.payload || !parsed.signature) {
    throw new Error('Invalid check-in QR data')
  }
  return parsed as CheckInQRData
}

export function isCheckInQR(data: unknown): data is CheckInQRData {
  return !!data && typeof data === 'object' && (data as any).type === 'check-in'
}

/**
 * Pull a check-in address out of whatever an attendee's QR contains. They might
 * show the raw SS58 passport QR or the signed challenge QR from the ticket page,
 * so both have to work here (a bare H160 too). We only need the address, so the
 * challenge signature is left alone. Returns null when there's nothing usable, so
 * the caller can show that rather than dropping the scan on the floor.
 */
export function extractCheckInAddress(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Most scans are just an address.
  if (isValidSs58(trimmed) || isValidEvmAddress(trimmed)) return trimmed

  // Otherwise it's the ticket page's challenge JSON, where the address lives.
  try {
    const parsed = JSON.parse(trimmed)
    if (isCheckInQR(parsed)) {
      const addr = parsed.payload?.attendeeAddress
      if (typeof addr === 'string' && (isValidSs58(addr) || isValidEvmAddress(addr))) {
        return addr
      }
    }
  } catch {
    // not JSON, so there's nothing here we can use
  }

  return null
}
