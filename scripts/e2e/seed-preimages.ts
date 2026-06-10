import type { TestHost } from '@parity/host-api-test-sdk/playwright'
import {
  buildChannelMetadata,
  buildSessionMetadata,
  buildWindowedMetadata,
} from './test-metadata'

/**
 * Seed the test host's preimage store with the festival, channel, and session
 * blobs the seed script put on Bulletin.
 *
 * In the host the product reads metadata only through the preimage manager, and
 * the test host has no Bulletin connection of its own, so these lookups need
 * their bytes up front or the metadata screens never render. seedPreimage keys
 * each blob by its blake2b digest, the same one the product looks up. Cheap and
 * idempotent, so calling it before each boot is fine.
 */
export async function seedFestivalPreimages(testHost: TestHost): Promise<void> {
  for (const bytes of [
    buildWindowedMetadata().bytes,
    buildChannelMetadata().bytes,
    buildSessionMetadata().bytes,
  ]) {
    await testHost.seedPreimage(bytes)
  }
}
