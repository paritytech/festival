import { test, expect } from './setup'
import { waitForAttendeeReady, navLink, firstInteractiveMarker } from './helpers'
import type { FrameLocator } from '@playwright/test'

async function tapBuilding(frame: FrameLocator): Promise<void> {
  const building = frame.locator('[data-testid="building-tap-target"]')
  await expect(building).toBeVisible()
  // The target div is an e2e-only geometry anchor with pointer-events:none.
  // Invoke its programmatic click hook; real user clicks still go through the
  // MapLibre canvas hit-test path.
  await building.evaluate((el) => (el as HTMLElement).click())
}

test.describe('Venue map', () => {
  test('renders the outdoor view with the tap-to-enter hint', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await expect(frame.locator('[data-testid="map-heading"]')).toBeVisible()
    await expect(frame.locator('[data-testid="venue-map"]')).toBeVisible()
    await expect(frame.locator('[data-testid="map-tap-hint"]')).toBeVisible()
    await expect(frame.locator('[data-testid="map-back-btn"]')).toHaveCount(0)
  })

  test('tapping the building enters indoor mode', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await tapBuilding(frame)

    // Indoor chrome appears.
    await expect(frame.locator('[data-testid="floor-control"]')).toBeVisible()
    await expect(frame.locator('[data-testid="map-empty-prompt"]')).toBeVisible()
    await expect(frame.locator('[data-testid="map-tap-hint"]')).toHaveCount(0)
  })

  test('indoor mode keeps the map heading and exit prompt visible', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await tapBuilding(frame)
    await expect(frame.locator('[data-testid="map-heading"]')).toBeVisible()
    await expect(frame.locator('[data-testid="map-empty-prompt"]')).toContainText('zoom out')
    await expect(frame.locator('[data-testid="map-back-btn"]')).toHaveCount(0)
  })

  test('selecting a marker shows the selected-location card', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await tapBuilding(frame)

    // The empty prompt only renders once the indoor transition has settled.
    // Clicks during the transition are ignored.
    await expect(frame.locator('[data-testid="map-empty-prompt"]')).toBeVisible()

    // Markers are positioned DOM elements. Click the first interactive one to
    // select it. (Progressive zoom-reveal makes some markers opacity:0 /
    // pointer-events:none at low zoom; a naive `.first()` can pick one of those
    // and the click is swallowed by the map canvas.)
    const marker = await firstInteractiveMarker(frame)
    await marker.click()
    const card = frame.locator('[data-testid="map-selected-card"]')
    await expect(card).toBeVisible()
    await expect(card.locator('.sel-card__row')).toBeVisible()
    await expect(card.locator('.sel-card__breadcrumb')).not.toHaveText('')
    // The description line is always populated — named markers show their label,
    // icon-only markers (empty label) fall back to their type label.
    await expect(card.locator('.sel-card__primary')).not.toHaveText('')

    // The session strip only renders when an entry is imminent. Assert it
    // is either absent or, when present, carries a source accent class.
    const strip = frame.locator('[data-testid="map-session-strip"]')
    if (await strip.count()) {
      await expect(strip).toHaveClass(/session-strip--(program|community)/)
    }

    // Close clears the selection and hides the card.
    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toHaveCount(0)
  })

  test('card dismisses on outside tap and does not persist across page nav', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await tapBuilding(frame)
    await expect(frame.locator('[data-testid="map-empty-prompt"]')).toBeVisible()

    const card = frame.locator('[data-testid="map-selected-card"]')

    // Selecting a marker pans/zooms the camera (`focusMarker`), so any marker
    // selection must start from a freshly-fitted floor view or the next click
    // can land off-viewport. Leaving /map clears the selection and remounting
    // re-fits the floor; mode is a session singleton, so we stay indoor.

    // ── A selected card does not persist across page nav ──
    await (await firstInteractiveMarker(frame)).click()
    await expect(card).toBeVisible()
    await (await navLink(frame, 'home')).click()
    await (await navLink(frame, 'map')).click()
    await expect(frame.locator('[data-testid="venue-map"]')).toBeVisible()
    await expect(card).toHaveCount(0)

    // ── Outside tap dismisses the card ──
    // We're back indoor on a freshly-fitted view, so markers are clickable.
    await expect(frame.locator('[data-testid="map-empty-prompt"]')).toBeVisible()
    await (await firstInteractiveMarker(frame)).click()
    await expect(card).toBeVisible()
    // Tap the empty top-left corner (the floor control sits top-right).
    await frame.locator('[data-testid="venue-map"]').click({
      position: { x: 20, y: 20 },
    })
    await expect(card).toHaveCount(0)
  })

  test('floor toggle swaps the active floor in indoor mode', async ({ testHost }) => {
    const frame = await waitForAttendeeReady(testHost)

    await (await navLink(frame, 'map')).click()
    await tapBuilding(frame)

    // Stack-variant control: each floor is a tab pill with aria-selected.
    // Click an inactive indoor pill (skipping the outdoor pseudo-floor, which
    // would trigger exit-to-outdoor instead of a floor swap) and assert the
    // selection moves to it.
    const floorControl = frame.locator('[data-testid="floor-control"]')
    await expect(floorControl).toBeVisible()
    const otherPill = floorControl
      .locator('[role="tab"][aria-selected="false"]:not([data-testid="floor-control-pill-venue"])')
      .first()
    await expect(otherPill).toBeVisible()
    const otherTestId = await otherPill.getAttribute('data-testid')
    expect(otherTestId).toBeTruthy()
    await otherPill.click()
    await expect(frame.locator(`[data-testid="${otherTestId}"]`)).toHaveAttribute('aria-selected', 'true')
  })
})
