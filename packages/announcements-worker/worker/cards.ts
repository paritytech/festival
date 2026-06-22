/**
 * Pure card builders: (data, state) → renderer node tree. No I/O.
 *
 * Buttons appear only where there's a real action. Schedule rows are richly
 * styled but NOT tappable (a wire Button is a text-only pill, no chip/title/
 * meta), so each schedule card carries one "Open …" pill instead.
 *
 * iOS renderer quirks honored throughout (see design-system.md):
 *  - Spacing uses ONLY 1-/2-value padding/margin: iOS decodes Dimensions as
 *    [vertical, horizontal, …], not CSS order — only those forms agree.
 *  - Left-aligned content is NOT fillW (a fillW container centers narrow content
 *    on iOS); pin left via the card's leading alignment.
 *  - Push-apart layouts use `arrange: 'spaceBetween'`, never a bare Spacer
 *    (Compose spacers have no flex weight → zero-sized on Android).
 *  - Solid rectangles need an inner sized child (iOS paints background before
 *    frame → an empty Box is 0×0).
 *
 * Action ids are `verb` or `verb:arg`; the message id comes from the render
 * request, never the action.
 */

import {
  bg,
  BoxN,
  Btn,
  Col,
  fillW,
  h,
  mar,
  type Mod,
  NIL,
  type Node,
  pad,
  RowN,
  rounded,
  Sp,
  Txt,
  w,
} from "./nodes";

export interface AnnouncementItem {
  /** Body CID — stable id. */
  id: string;
  sender: string;
  /** Display string, e.g. "Today · 09:12". */
  time: string;
  content: string;
}

export interface ScheduleItem {
  id: string;
  /** "HH:MM" chip text. */
  time: string;
  /** Unix ms start. */
  startMs: number;
  /** Unix ms end — for render-time upcoming filtering. */
  endMs: number;
  /** Minutes since local midnight — for time-query window math. */
  startMin: number;
  title: string;
  /** Joined display line: "speaker · room". Empty when unknown. */
  meta: string;
  room?: string;
  /** "Talk" or "Session" — time-query meta prefix. */
  kindLabel: string;
  /** Footer label, e.g. "Wed 11 Jun". */
  dateLabel: string;
}

export interface CardState {
  page: number;
}

export const initialCardState = (): CardState => ({ page: 0 });

export const PAGE_SIZE = 3;

/** Hard cap on an announcement body — there's no detail page to expand into. */
export const MAX_CONTENT = 400;

/** Word-boundary clamp so a runaway announcement can't blow up the card. */
export function clampContent(content: string): string {
  if (content.length <= MAX_CONTENT) return content;
  const cut = content.slice(0, MAX_CONTENT);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > MAX_CONTENT - 80 ? sp : MAX_CONTENT).trimEnd()}…`;
}

// ── buttons ────────────────────────────────────────────────────────────────

interface BtnProps {
  text: string;
  clickAction?: string;
  loading?: boolean;
  enabled?: boolean;
}

const PILL_FRAME = 3;
const PILL_RADIUS = 12 + PILL_FRAME; // inner button radius is a host-fixed 12.

/**
 * The only legible + fully-tappable button on every theme: a real `primary`
 * button (white fill, black label, whole pill taps) inside a thin `fg.primary`
 * frame for contrast. `primary` is the sole legible variant, but a bare white
 * pill washes out on light cards; the frame adapts for free (dark ring on light
 * themes, harmless light ring on dark). The frame is visual only — taps land on
 * the inner pill, so never fake this with a transparent `text` button in a Box.
 */
function pill(props: BtnProps, mods: Mod[] = []): Node {
  return BoxN(
    {
      align: "center",
      mods: [...mods, pad(PILL_FRAME), bg("fg.primary", rounded(PILL_RADIUS))],
    },
    [Btn({ ...props, variant: "primary" }, [fillW])],
  );
}

// ── layout idioms ──────────────────────────────────────────────────────────

const gap = (height: number): Node => Sp([h(height)]);
const hgap = (width: number): Node => Sp([w(width)]);

/** Holds a fixed-width child at the left (skeleton bars). */
const lrow = (node: Node): Node => RowN({}, [node, Sp()]);

/** Two children pushed to opposite edges. */
const apart = (left: Node, right: Node, align: "center" | "top" = "center"): Node =>
  RowN({ align, arrange: "spaceBetween", mods: [fillW] }, [left, right]);

/** Solid rectangle — the inner sized child gives the background its size on iOS. */
const rect = (width: number, height: number, radius: number): Node =>
  BoxN({ align: "center", mods: [bg("bg.surface.nested", rounded(radius))] }, [
    RowN({ mods: [w(width), h(height)] }, []),
  ]);

const divider = (vMargin = 13): Node =>
  BoxN(
    { align: "center", mods: [fillW, mar([vMargin, 0]), bg("bg.surface.nested")] },
    [RowN({ mods: [h(1)] }, [Sp()])],
  );

// ── shared pieces ────────────────────────────────────────────────────────

const CARD = (children: Node[]): Node =>
  Col(
    { align: "start", mods: [fillW, pad(15), bg("bg.surface.container", rounded(14))] },
    children,
  );

const header = (title: string, sub?: string): Node =>
  Col({ align: "start" }, [
    Txt(title, "title.medium.regular", "fg.primary"),
    sub ? Txt(sub, "body.small.regular", "fg.tertiary", [mar([2, 0])]) : NIL,
  ]);

// ── welcome / menu ───────────────────────────────────────────────────────

export function welcomeCard(festivalName: string, subscribed: boolean): Node {
  const qa = (label: string, action: string): Node =>
    pill({ text: label, clickAction: action }, [fillW]);
  return CARD([
    header(festivalName, "Your in-chat W3S concierge"),
    gap(12),
    Txt("Catch up on what’s new or see what’s on:", "body.large.regular", "fg.secondary"),
    gap(8),
    qa("Latest announcements", "qa:announcements"),
    gap(8),
    qa("Upcoming talks", "qa:talks"),
    gap(8),
    qa("Upcoming activations", "qa:activations"),
    gap(8),
    qa("Community sessions", "qa:sessions"),
    gap(8),
    qa("Take me to the map", "open:map"),
    divider(14),
    // Single broadcast toggle; the label reflects current state.
    qa(subscribed ? "You’re in the loop" : "Keep me posted", subscribed ? "sub:off" : "sub:on"),
    gap(6),
    Txt("New announcements land here.", "body.small.regular", "fg.tertiary"),
  ]);
}

// ── announcements (content only, no buttons) ──────────────────────────────

function announcementItem(a: AnnouncementItem): Node {
  return Col({ align: "start", mods: [fillW] }, [
    apart(
      Txt(`From: ${a.sender}`, "body.small.regular", "fg.tertiary"),
      Txt(a.time, "body.small.regular", "fg.tertiary"),
    ),
    gap(5),
    Txt(clampContent(a.content), "body.large.regular", "fg.secondary"),
  ]);
}

export function announcementsCard(items: AnnouncementItem[], festivalName: string): Node {
  const rows: Node[] = [];
  items.forEach((a, i) => {
    rows.push(announcementItem(a));
    if (i < items.length - 1) rows.push(divider());
  });
  return CARD([
    header("Latest announcements", `${items.length} latest · ${festivalName}`),
    divider(14),
    ...(items.length > 0
      ? rows
      : [Txt("No announcements have been posted yet.", "body.large.regular", "fg.tertiary")]),
  ]);
}

/** A single freshly-broadcast announcement. */
export function announcementPostCard(a: AnnouncementItem): Node {
  return CARD([announcementItem(a)]);
}

// ── schedule (talks + sessions share this) ───────────────────────────────

const timeChip = (time: string): Node =>
  BoxN(
    { align: "center", mods: [pad([8, 12]), bg("bg.surface.nested", rounded(9))] },
    [Txt(time, "body.medium.regular", "fg.primary")],
  );

/** Rich, non-tappable row: time chip + title + dimmed speaker/room. */
function scheduleRow(item: ScheduleItem): Node {
  return RowN({ align: "top" }, [
    timeChip(item.time),
    hgap(12),
    Col({ align: "start" }, [
      Txt(item.title, "body.large.regular", "fg.primary"),
      item.meta ? Txt(item.meta, "body.small.regular", "fg.tertiary", [mar([2, 0])]) : NIL,
    ]),
  ]);
}

export function scheduleCard(
  kind: "talks" | "sessions" | "activations",
  items: ScheduleItem[],
  state: CardState,
): Node {
  const isTalks = kind === "talks";
  const isActivations = kind === "activations";
  const title = isTalks
    ? "Upcoming talks"
    : isActivations
      ? "Upcoming activations"
      : "Community sessions";
  // Both kinds open the SPA's unified schedule (/#/program).
  const openCta = pill({ text: "Open schedule", clickAction: "open:schedule" }, [fillW]);
  if (items.length === 0) {
    return CARD([
      header(title),
      divider(14),
      Txt(
        isTalks
          ? "No talks on the schedule yet."
          : isActivations
            ? "No activations scheduled yet."
            : "No community sessions yet.",
        "body.large.regular",
        "fg.tertiary",
      ),
      gap(12),
      openCta,
    ]);
  }

  const start = state.page * PAGE_SIZE;
  const shown = items.slice(start, start + PAGE_SIZE);
  const dateLabel = shown[0]?.dateLabel ?? items[0].dateLabel;
  const atEnd = start + PAGE_SIZE >= items.length;
  const multiPage = items.length > PAGE_SIZE;

  const rows: Node[] = [];
  shown.forEach((it, i) => {
    rows.push(scheduleRow(it));
    if (i < shown.length - 1) rows.push(divider(14));
  });

  // Two stacked full-width pills, never side by side: two greedy pills can't be
  // separated by spaceBetween, and Android can't split them.
  const footer: Node[] = [];
  if (multiPage) {
    footer.push(
      pill(
        atEnd
          ? { text: "Start over", clickAction: "restart" }
          : { text: `See ${PAGE_SIZE} more`, clickAction: "more" },
        [fillW],
      ),
      gap(8),
    );
  }
  footer.push(openCta);

  return CARD([
    header(title, `Showing ${start + 1}–${start + shown.length} of ${items.length} · ${dateLabel}`),
    divider(14),
    ...rows,
    divider(14),
    ...footer,
  ]);
}

// ── time query ("what happens at HH:MM") ─────────────────────────────────

/** Lookahead window for the time-query card, minutes. */
export const TIME_WINDOW_MIN = 75;

export function timeQueryCard(min: number, items: ScheduleItem[]): Node {
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");

  if (items.length === 0) {
    return CARD([
      header(`Around ${hh}:${mm}`),
      divider(14),
      Txt(
        "Nothing scheduled in that window — it’s a break, or past the last session.",
        "body.large.regular",
        "fg.tertiary",
      ),
      gap(12),
      pill({ text: "See upcoming talks", clickAction: "qa:talks" }, [fillW]),
    ]);
  }

  const rows: Node[] = [];
  items.forEach((it, i) => {
    rows.push(
      RowN({ align: "top" }, [
        timeChip(it.time),
        hgap(12),
        Col({ align: "start" }, [
          Txt(it.title, "body.large.regular", "fg.primary"),
          Txt(
            it.meta ? `${it.kindLabel} · ${it.meta}` : it.kindLabel,
            "body.small.regular",
            "fg.tertiary",
            [mar([2, 0])],
          ),
        ]),
      ]),
    );
    if (i < items.length - 1) rows.push(divider());
  });

  return CARD([
    header(`Around ${hh}:${mm}`, `${items.length} on now & next`),
    divider(14),
    ...rows,
    divider(14),
    pill({ text: "Open schedule", clickAction: "open:schedule" }, [fillW]),
  ]);
}

// ── error + loading ──────────────────────────────────────────────────────

export function errorCard(message: string): Node {
  return CARD([
    apart(
      RowN({ align: "center" }, [
        Txt("⚠️", "body.large.regular", "fg.error"),
        hgap(9),
        Txt(message, "body.medium.regular", "fg.secondary"),
      ]),
      pill({ text: "Retry", clickAction: "retry" }),
    ),
  ]);
}

export function loadingCard(): Node {
  const bar = (width: number) => rect(width, 11, 6);
  return CARD([
    Col({ align: "start", mods: [fillW] }, [lrow(bar(170)), gap(7), lrow(bar(120))]),
    divider(14),
    lrow(bar(230)),
    gap(8),
    lrow(bar(190)),
    gap(8),
    lrow(bar(210)),
  ]);
}
