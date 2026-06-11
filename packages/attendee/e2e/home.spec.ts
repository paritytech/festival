import { test, expect } from './setup'
import { waitForAttendeeReady } from './helpers'
import { seedFestivalPreimages } from '../../../scripts/e2e/seed-preimages'

test.describe('Attendee home', () => {
  test('cold-boot splash plays then detaches before home renders', async ({ testHost }) => {
    // This test skips waitForAttendeeReady, so seed the preimages here too.
    await seedFestivalPreimages(testHost)
    await testHost.waitForConnection(60_000)
    const frame = testHost.productFrame()

    const splash = frame.locator('[data-testid="loading-splash"]')
    // Splash mounts on cold boot. Allow a brief window for the iframe to attach.
    await splash.waitFor({ state: 'attached', timeout: 10_000 })
    // Animation + fade total ~2.7s under normal motion; allow headroom for
    // the soft-wait on wallet/festival readiness (hard-capped at 4s in app).
    await splash.waitFor({ state: 'detached', timeout: 15_000 })

    await expect(frame.locator('[data-testid="home-heading"]')).toBeVisible()
  })

  test('home page renders heading and passport card', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await expect(frame.locator('[data-testid="home-heading"]')).toBeVisible()
    await expect(frame.locator('[data-testid="home-passport"]')).toBeVisible()
    await expect(frame.locator('[data-testid="passport-festival-name"]')).toBeVisible()
  })

  test('primary navigation surfaces are rendered', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    // Both surfaces exist in the DOM at any viewport. Tailwind toggles
    // visibility via responsive classes. We just verify they're rendered.
    await expect(frame.locator('[data-testid="attendee-sidebar"]')).toBeAttached()
    await expect(frame.locator('[data-testid="attendee-tab-bar"]')).toBeAttached()
  })

  test('location card renders and is interactive', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    const location = frame.locator('[data-testid="home-location"]')
    await expect(location).toBeVisible()
    await expect(location).toContainText(/Berlin|Funkhaus|,/)
  })

  test('notifications bell renders for checked-in user and opens the inbox', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    // Seed manualCheckIn's Bob, so the bell (checked-in only) must render.
    const bell = frame.locator('[data-testid="notifications-bell"]')
    await expect(bell).toBeVisible()

    await bell.click()
    await expect(frame.locator('[data-testid="notifications-heading"]')).toBeVisible()
  })

  test('passport hides QR once checked in', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    // The seed step manualCheckIn's Bob on the fresh festival, so the
    // not-checked-in marquee + locked cards must not render.
    await expect(frame.locator('[data-testid="passport-band-not-checked-in"]')).toHaveCount(0)
    await expect(frame.locator('[data-testid="check-in-to-unlock"]')).toHaveCount(0)
    await expect(frame.locator('[data-testid="locked-host-card"]')).toHaveCount(0)
    await expect(frame.locator('[data-testid="locked-build-card"]')).toHaveCount(0)

    // QR section is removed entirely once checked in. No reveal area, no QR.
    await expect(frame.locator('[data-testid="passport-reveal-area"]')).toHaveCount(0)
    await expect(frame.locator('[data-testid="passport-real-qr"]')).toHaveCount(0)
  })
})
