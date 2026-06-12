import type { TestHost } from '@parity/host-api-test-sdk/playwright'
import type { FrameLocator } from '@playwright/test'
import { seedFestivalPreimages } from '../../../scripts/e2e/seed-preimages'

/**
 * Wait until the festival layout has booted AND roles have resolved.
 *
 * The layout shell renders before the chain reads finish, so the role-gated nav
 * items (`v-if="rolesReady"`) don't exist yet and tests that click them race
 * that gap. Waiting for `nav-item-overview` (which appears only once roles are
 * ready) guarantees the full nav is interactive. The `create-festival-heading`
 * branch covers the no-festival / non-role-bearing path.
 */
export async function waitForAdminReady(
  testHost: TestHost,
  options?: { timeout?: number },
): Promise<FrameLocator> {
  const timeout = options?.timeout ?? 60_000
  // In the host, metadata resolves only through the preimage manager, and the
  // test host has no Bulletin connection, so seed the blobs before boot.
  await seedFestivalPreimages(testHost)
  await testHost.waitForConnection(timeout)
  const frame = testHost.productFrame()

  await frame
    .locator('[data-testid="nav-item-overview"]')
    .or(frame.locator('[data-testid="create-festival-heading"]'))
    .first()
    .waitFor({ state: 'visible', timeout })

  return frame
}
