/** Pure mappers: raw docs / on-chain reads → card item shapes. I/O lives in data.ts. */

import { type AnnouncementItem, type ScheduleItem } from "./cards";
import { type AnnouncementBody, type ScheduleEntry } from "./config";
import { fmtAnnouncementTime, fmtDateLabel, fmtHM, minutesOfDay } from "./time";

export interface FestivalInfo {
  name: string;
  schedule: ScheduleEntry[];
  /** VenueMarker.id → label ("Main Stage", "Lab 1", …). */
  markerLabels: Map<string, string>;
}

export function announcementItemFrom(cid: string, body: AnnouncementBody): AnnouncementItem {
  return {
    id: cid,
    sender: body.senderName?.trim() || "Organizers",
    time: fmtAnnouncementTime(body.timestamp),
    content: body.content,
  };
}

function metaLine(speakers: string[], room: string | undefined): string {
  return [speakers.join(", "), room].filter(Boolean).join("  ·  ");
}

export function toScheduleItem(
  id: string,
  start: Date,
  end: Date,
  title: string,
  speakers: string[],
  room: string | undefined,
  kindLabel: "Talk" | "Session" | "Activation",
): ScheduleItem {
  return {
    id,
    time: fmtHM(start),
    startMs: start.getTime(),
    endMs: end.getTime(),
    startMin: minutesOfDay(start),
    title,
    meta: metaLine(speakers, room),
    room,
    kindLabel,
    dateLabel: fmtDateLabel(start),
  };
}

/**
 * Ongoing + future items; when everything is past, keep everything (the card
 * stays useful after the event).
 */
export function upcomingItems(items: ScheduleItem[], now: number = Date.now()): ScheduleItem[] {
  const upcoming = items.filter((it) => it.endMs >= now);
  return upcoming.length > 0 ? upcoming : items;
}

/**
 * Festival talks, sorted by start. Activations run all day and aren't talks, so
 * we drop them here and they never reach the talks or time window cards. The
 * time filtering happens later, in `upcomingItems`.
 */
export function talksFrom(festival: FestivalInfo): ScheduleItem[] {
  return festival.schedule
    .filter((e) => e.category !== "activations")
    .map((e) => ({ entry: e, start: new Date(e.start), end: new Date(e.end) }))
    .filter(({ start, end }) => !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ entry, start, end }) =>
      toScheduleItem(
        entry.id || entry.start + entry.title,
        start,
        end,
        entry.title,
        entry.speakers ?? [],
        entry.venueMarkerId ? festival.markerLabels.get(entry.venueMarkerId) : undefined,
        "Talk",
      ),
    );
}

/**
 * Festival activations (category === 'activations'), sorted by start. These run
 * all day and get their own card, separate from the talks. Time filtering
 * happens later, in `upcomingItems`.
 */
export function activationsFrom(festival: FestivalInfo): ScheduleItem[] {
  return festival.schedule
    .filter((e) => e.category === "activations")
    .map((e) => ({ entry: e, start: new Date(e.start), end: new Date(e.end) }))
    .filter(({ start, end }) => !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ entry, start, end }) =>
      toScheduleItem(
        entry.id || entry.start + entry.title,
        start,
        end,
        entry.title,
        entry.speakers ?? [],
        entry.venueMarkerId ? festival.markerLabels.get(entry.venueMarkerId) : undefined,
        "Activation",
      ),
    );
}

/** Merge talks + sessions inside the lookahead window starting at `min`. */
export function timeWindowItems(
  talks: ScheduleItem[],
  sessions: ScheduleItem[],
  min: number,
  windowMin: number,
  max = 4,
): ScheduleItem[] {
  return [...talks, ...sessions]
    .filter((it) => it.startMin >= min && it.startMin <= min + windowMin)
    .sort((a, b) => a.startMin - b.startMin)
    .slice(0, max);
}
