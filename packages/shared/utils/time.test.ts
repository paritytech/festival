import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_CHECKIN_GRACE_MS,
  formatClosesIn,
  formatCountdown,
} from './time'

test('SESSION_CHECKIN_GRACE_MS is sized so the countdown opens at 59 min', () => {
  // 59 minutes (not a round hour) so the label never momentarily reads "60 min".
  assert.equal(SESSION_CHECKIN_GRACE_MS, 59 * 60 * 1000)
  assert.equal(formatClosesIn(SESSION_CHECKIN_GRACE_MS), '59 min')
})

test('formatClosesIn rounds up to whole minutes', () => {
  assert.equal(formatClosesIn(30 * 60 * 1000), '30 min')
  assert.equal(formatClosesIn(90_000), '2 min') // 1.5 min rounds up
  assert.equal(formatClosesIn(60_000), '1 min')
})

test('formatClosesIn floors at "1 min" through the tick gap', () => {
  // The 30s `useNow` tick can leave `now` just past the deadline before the
  // CTA state flips to ended; never show "0 min" or a negative count.
  assert.equal(formatClosesIn(30_000), '1 min')
  assert.equal(formatClosesIn(0), '1 min')
  assert.equal(formatClosesIn(-5_000), '1 min')
})

test('formatCountdown keeps the hours/minutes format for the upcoming CTA', () => {
  assert.equal(formatCountdown(2 * 60 * 60 * 1000), '2h')
  assert.equal(formatCountdown(90 * 60 * 1000), '1h 30m')
  assert.equal(formatCountdown(45 * 60 * 1000), '45m')
  assert.equal(formatCountdown(0), '0m')
})
