import { test, expect } from './setup'
import { waitForAttendeeReady } from './helpers'

// Bob is checked in on-chain by the seed script, so the onboarding screen
// must render the checked-in view — never the check-in QR passport.
test.describe('Onboarding', () => {
  test('shows the checked-in view instead of the QR for a checked-in attendee', async ({ testHost }) => {
    await waitForAttendeeReady(testHost)

    const iframe = testHost.page
      .frames()
      .find((f) => f.url().includes('localhost:3200'))
    if (!iframe) throw new Error('attendee iframe not found')
    await iframe.evaluate(() => {
      window.location.hash = '#/onboarding'
    })

    const frame = testHost.productFrame()
    await expect(frame.locator('[data-testid="onboarding-checked-in"]')).toBeVisible()
    await expect(frame.locator('[data-testid="onboarding-page"]')).toHaveCount(0)
  })
})
