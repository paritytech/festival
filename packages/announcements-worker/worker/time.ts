/** Pure time formatting + free-text intent parsing. No host/chain imports. */

/**
 * Bound a host-routed read. Those reads have no timeout of their own and hang
 * indefinitely while the host pauses the worker's connections, so every await
 * on one must be wrapped.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Minutes since local midnight. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Footer label, e.g. "Wed 11 Jun". */
export function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "Today · 09:12" / "Yesterday · 17:45" / "Wed 11 Jun · 17:45". */
export function fmtAnnouncementTime(timestamp: number, now: Date = new Date()): string {
  if (!Number.isFinite(timestamp)) return "";
  const d = new Date(timestamp);
  const day =
    d.toDateString() === now.toDateString()
      ? "Today"
      : d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()
        ? "Yesterday"
        : fmtDateLabel(d);
  return `${day} · ${fmtHM(d)}`;
}

/**
 * Parse a free-text time → minutes since midnight, or null. Handles "3pm",
 * "14:00", "15.30", "2 pm", bare hours.
 */
export function parseTimeQuery(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let m = t.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?/);
  if (m) {
    let hour = +m[1];
    const min = +m[2];
    if (m[3] === "pm" && hour < 12) hour += 12;
    if (m[3] === "am" && hour === 12) hour = 0;
    return hour * 60 + min;
  }
  m = t.match(/(\d{1,2})\s*(am|pm)/);
  if (m) {
    let hour = +m[1];
    if (m[2] === "pm" && hour < 12) hour += 12;
    if (m[2] === "am" && hour === 12) hour = 0;
    return hour * 60;
  }
  m = t.match(/\b(\d{1,2})\b/);
  if (m && +m[1] <= 23) return +m[1] * 60;
  return null;
}

export type Intent =
  | { kind: "announcements" | "talks" | "sessions" | "more" | "fallback" }
  | { kind: "timeQuery"; min: number };

/** Route free text to a card intent. */
export function parseComposer(text: string): Intent {
  const t = text.toLowerCase().trim();
  const min = parseTimeQuery(t);
  const wantsMore = /\b(more|next|another|three more|3 more)\b/.test(t);
  const wantsTime = min != null && /(what|happen|happening|on|at|around|whats on|what's on)/.test(t);
  if (wantsMore) return { kind: "more" };
  if (wantsTime && min != null) return { kind: "timeQuery", min };
  if (/(announce|news|what'?s new|latest|update)/.test(t)) return { kind: "announcements" };
  if (/(workshop|session|panel|agenda|lab|hands)/.test(t)) return { kind: "sessions" };
  if (/(talk|keynote|speaker|schedule|line ?up)/.test(t)) return { kind: "talks" };
  if (min != null) return { kind: "timeQuery", min };
  return { kind: "fallback" };
}
