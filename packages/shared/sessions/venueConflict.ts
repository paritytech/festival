/**
 * Detects when a candidate session would book a venue marker that's already
 * taken by another sub-event or an official program entry during the same
 * time window. Used at the picker (to dim busy markers) and at submit time
 * (final-check before the create / update tx).
 *
 * Times are unix seconds. Touching at an endpoint is NOT a conflict
 * (one session ending at 14:00 doesn't block another starting at 14:00).
 */

import type { ScheduleEntry, VenueMarker } from "../metadata/schemas";
import {
  findNearestMarker,
  isCoordLocation,
  parseCoordLocation,
} from "../venue/floors";

export interface VenueConflictItem {
  kind: "session" | "official";
  title: string;
  startSec: number;
  endSec: number;
}

interface SubEventLike {
  address: string;
  startTime: number;
  endTime: number;
  /** Optional: callers may pass already-filtered lists with no `cancelled` field. */
  cancelled?: boolean;
  metadata: { name: string; location?: string };
}

/** Resolve a stored session location string back to a marker id, or null
 *  when the location is a free-form coordinate with no nearby marker. */
function resolveLocationMarkerId(
  location: string | undefined,
  markers: VenueMarker[],
): string | null {
  if (!location) return null;
  if (isCoordLocation(location)) {
    const coord = parseCoordLocation(location);
    if (!coord) return null;
    return findNearestMarker(coord.x, coord.y, coord.floorId, markers)?.id ?? null;
  }
  return location;
}

function intervalsOverlap(
  a1: number,
  a2: number,
  b1: number,
  b2: number,
): boolean {
  return a1 < b2 && b1 < a2;
}

/** Returns the first conflicting item, or null if [startSec, endSec] is free
 *  at `markerId`. Excludes cancelled sub-events and the sub-event matching
 *  `excludeAddress` (used when editing an existing session). */
export function findVenueConflict(
  markerId: string,
  startSec: number,
  endSec: number,
  subEvents: SubEventLike[],
  schedule: ScheduleEntry[],
  markers: VenueMarker[],
  excludeAddress?: string,
): VenueConflictItem | null {
  for (const se of subEvents) {
    if (se.cancelled) continue;
    if (
      excludeAddress &&
      se.address.toLowerCase() === excludeAddress.toLowerCase()
    )
      continue;
    const seMarker = resolveLocationMarkerId(se.metadata.location, markers);
    if (seMarker !== markerId) continue;
    if (intervalsOverlap(startSec, endSec, se.startTime, se.endTime)) {
      return {
        kind: "session",
        title: se.metadata.name,
        startSec: se.startTime,
        endSec: se.endTime,
      };
    }
  }

  for (const entry of schedule) {
    if (entry.venueMarkerId !== markerId) continue;
    const eStart = Math.floor(new Date(entry.start).getTime() / 1000);
    const eEnd = Math.floor(new Date(entry.end).getTime() / 1000);
    if (intervalsOverlap(startSec, endSec, eStart, eEnd)) {
      return {
        kind: "official",
        title: entry.title,
        startSec: eStart,
        endSec: eEnd,
      };
    }
  }

  return null;
}

/** Returns the set of marker IDs that have at least one conflict in the given
 *  time window. Used to grey-out busy markers in the picker. */
export function findBusyMarkerIds(
  startSec: number,
  endSec: number,
  candidateMarkerIds: readonly string[],
  subEvents: SubEventLike[],
  schedule: ScheduleEntry[],
  markers: VenueMarker[],
  excludeAddress?: string,
): Set<string> {
  const busy = new Set<string>();
  for (const id of candidateMarkerIds) {
    if (
      findVenueConflict(
        id,
        startSec,
        endSec,
        subEvents,
        schedule,
        markers,
        excludeAddress,
      )
    ) {
      busy.add(id);
    }
  }
  return busy;
}
