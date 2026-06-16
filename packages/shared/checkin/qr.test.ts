import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeCheckInQR, extractCheckInAddress } from './qr'
import type { CheckInPayload } from './sign'

// Alice's well-known SS58 dev address + an arbitrary valid H160.
const SS58 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const H160 = '0x1234567890123456789012345678901234567890'

test('extractCheckInAddress: raw SS58 passes through (passport QR)', () => {
  assert.equal(extractCheckInAddress(SS58), SS58)
  assert.equal(extractCheckInAddress(`  ${SS58}  `), SS58)
})

test('extractCheckInAddress: raw H160 passes through', () => {
  assert.equal(extractCheckInAddress(H160), H160)
})

test('extractCheckInAddress: signed challenge QR → attendee address (ticket QR)', () => {
  const payload: CheckInPayload = {
    type: 'check-in',
    festivalAddress: H160,
    ticketTokenId: 1,
    attendeeAddress: SS58,
    timestamp: 1_700_000_000_000,
  }
  const qr = encodeCheckInQR(payload, '0xsignature')
  assert.equal(extractCheckInAddress(qr), SS58)
})

test('extractCheckInAddress: garbage / empty → null (never silently accepted)', () => {
  assert.equal(extractCheckInAddress(''), null)
  assert.equal(extractCheckInAddress('   '), null)
  assert.equal(extractCheckInAddress('not-an-address'), null)
  assert.equal(extractCheckInAddress('https://example.com/foo'), null)
})

test('extractCheckInAddress: JSON without a valid check-in payload → null', () => {
  assert.equal(extractCheckInAddress(JSON.stringify({ type: 'other', payload: {} })), null)
  assert.equal(
    extractCheckInAddress(
      JSON.stringify({ type: 'check-in', payload: { attendeeAddress: 'bogus' }, signature: 'x' }),
    ),
    null,
  )
})
