/**
 * Builds the FestivalMetadata blob that the e2e seed script uploads to the
 * Bulletin chain and references from `Festival.setup(metadataCid, …)`.
 *
 * Content is **windowed** so the CID is stable across runs that land in the
 * same 10-day bucket. Within a bucket, consecutive deploys hit the same CID
 * and the IPFS gateway HEAD probe lets us skip the bulletin upload.
 */

import type {
  FestivalMetadata,
  SubEventMetadata,
  ChannelMetadata,
} from '../../packages/shared/metadata/schemas'

const SECONDS_PER_DAY = 86400n
const WINDOW_DAYS = 10n
export const WINDOW_SECONDS = WINDOW_DAYS * SECONDS_PER_DAY

export interface MetadataWindow {
  /** UNIX seconds, floor(nowSec / 10d) * 10d. */
  startSec: bigint
  /** startSec + 10·86400. */
  endSec: bigint
  metadata: FestivalMetadata
  /** Canonical UTF-8 JSON encoding of `metadata` (stable across machines). */
  bytes: Uint8Array
}

export function nowUnixSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

function floorToWindow(nowSec: bigint): bigint {
  return (nowSec / WINDOW_SECONDS) * WINDOW_SECONDS
}

function isoSec(sec: bigint): string {
  return new Date(Number(sec) * 1000).toISOString()
}

/**
 * Build a deterministic metadata fixture anchored at the current 10-day window.
 *
 * The content covers every field the admin + attendee e2e suites read:
 *  - `name`/`description`/`organizer`/`website`/`tags`. Overview, settings, draft watcher
 *  - `location.venue` includes "Funkhaus". Matches attendee home regex
 *  - `schedule` has at least one entry inside the window. Schedule.spec.ts
 *  - `venueMap` carries a marker + zone so the map editor surfaces render
 */
export function buildWindowedMetadata(nowSec: bigint = nowUnixSec()): MetadataWindow {
  const startSec = floorToWindow(nowSec)
  const endSec = startSec + WINDOW_SECONDS

  const scheduleStart = startSec + 3n * 3600n // window start + 3h
  const scheduleEnd = scheduleStart + 3600n   // 1h slot

  const metadata: FestivalMetadata = {
    version: '1.0.0',
    type: 'festival',
    name: 'E2E Test Festival',
    description: 'Deterministic festival fixture used by the e2e seed script.',
    location: {
      venue: 'Funkhaus Berlin',
      address: 'Nalepastraße 18, 12459 Berlin',
      coordinates: { lat: 52.4625, lng: 13.5258 },
    },
    image: '',
    website: 'https://example.invalid/e2e',
    organizer: 'E2E Harness',
    tags: ['e2e', 'test'],
    schedule: [
      {
        id: 'e2e-keynote',
        start: isoSec(scheduleStart),
        end: isoSec(scheduleEnd),
        title: 'Opening Keynote',
        description: 'E2E fixture session — schedule rendering check.',
        speakers: ['Alice', 'Bob'],
        category: 'official',
      },
      {
        id: 'e2e-activation',
        start: isoSec(scheduleStart),
        end: isoSec(scheduleStart + 8n * 3600n),
        title: 'All-Day Lounge',
        description: 'E2E fixture activation — all-day programming, category rendering check.',
        speakers: ['Carol'],
        category: 'activations',
      },
    ],
    venueMap: {
      blocks: [],
      zones: [
        {
          id: 'block-b-first-ground-stage',
          floorId: 'block-b-first-ground',
          label: 'Main Stage',
        },
      ],
      markers: [
        {
          id: 'e2e-stage',
          label: 'Main Stage',
          x: 500,
          y: 500,
          floorId: 'block-b-first-ground',
          category: 'base',
          type: 'stage',
          zoneId: 'block-b-first-ground-stage',
        },
      ],
    },
    festivalPoapImage: '',
  }

  const bytes = new TextEncoder().encode(JSON.stringify(metadata))

  return { startSec, endSec, metadata, bytes }
}

export interface SessionMetadataFixture {
  metadata: SubEventMetadata
  /** Canonical UTF-8 JSON encoding of `metadata`. */
  bytes: Uint8Array
}

/**
 * Build the SubEventMetadata blob for the e2e seed's community session.
 *
 * This MUST be a distinct blob from the festival metadata. Reusing the
 * festival CID (the previous shortcut) makes the session resolve to a
 * `FestivalMetadata` document, whose `location` is an object. And the
 * attendee map's session-strip path (`isCoordLocation`) then throws on
 * `location.startsWith(...)` the moment a marker is selected.
 *
 * `location` is the `e2e-stage` marker id from `buildWindowedMetadata`'s
 * venueMap, so the session resolves to that marker and exercises the
 * map session-strip surface for real.
 */
export function buildSessionMetadata(): SessionMetadataFixture {
  const metadata: SubEventMetadata = {
    version: '1.0',
    type: 'sub-event',
    name: 'E2E Community Session',
    description: 'Deterministic sub-event fixture used by the e2e seed script.',
    location: 'e2e-stage',
    speakers: ['Alice'],
  }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  return { metadata, bytes }
}

export interface ChannelMetadataFixture {
  metadata: ChannelMetadata
  /** Canonical UTF-8 JSON encoding of `metadata`. */
  bytes: Uint8Array
}

/**
 * Build the empty announcement channel blob the seed uploads with the festival.
 *
 * `createdAt` follows the same window as the festival rather than `Date.now()`,
 * so the CID stays stable across runs. That lets the seed skip a duplicate
 * upload, and lets the e2e harness rebuild the exact bytes to seed the test host.
 */
export function buildChannelMetadata(
  nowSec: bigint = nowUnixSec(),
): ChannelMetadataFixture {
  const startSec = floorToWindow(nowSec)
  const metadata: ChannelMetadata = {
    createdAt: Number(startSec) * 1000,
    announcements: [],
  }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  return { metadata, bytes }
}
