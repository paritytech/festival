/**
 * Typed builders over the host custom-renderer wire format.
 *
 * Cards are authored as token names only (`fg.primary`, `Rounded(14)`) — the
 * host resolves them against its active theme at render time, so nothing here
 * can carry a hex color. Numeric dimensions are px (desktop) / dp (mobile).
 */

import type { CodecType, CustomRendererNode, Modifier } from "@novasamatech/host-api";

export type Node = CodecType<typeof CustomRendererNode>;
export type Mod = CodecType<typeof Modifier>;

type BoxValue = Extract<Node, { tag: "Box" }>["value"];
type ColumnValue = Extract<Node, { tag: "Column" }>["value"];
type RowValue = Extract<Node, { tag: "Row" }>["value"];
type TextValue = Extract<Node, { tag: "Text" }>["value"];
type ButtonValue = Extract<Node, { tag: "Button" }>["value"];

export type ColorToken = NonNullable<TextValue["props"]["color"]>;
export type TypographyToken = NonNullable<TextValue["props"]["style"]>;
export type ButtonVariant = NonNullable<ButtonValue["props"]["variant"]>;
type ContentAlignment = BoxValue["props"]["contentAlignment"];
type HorizontalAlignment = ColumnValue["props"]["horizontalAlignment"];
type Arrangement = ColumnValue["props"]["verticalArrangement"];
type VerticalAlignment = RowValue["props"]["verticalAlignment"];

type Shape = NonNullable<Extract<Mod, { tag: "background" }>["value"]["shape"]>;
type Dimensions = Extract<Mod, { tag: "padding" }>["value"];

export const NIL: Node = { tag: "Nil", value: undefined };

// ── modifiers ────────────────────────────────────────────────────────────

/** 1–4 number shorthand → the fixed 4-slot Dimensions tuple (CSS order). */
function dims(d: number | number[]): Dimensions {
  const a = Array.isArray(d) ? d : [d];
  return [a[0], a[1] ?? a[0], a[2], a[3]];
}

export const rounded = (radius: number): Shape => ({ tag: "Rounded", value: radius });
export const circle: Shape = { tag: "Circle", value: undefined };

export const pad = (d: number | number[]): Mod => ({ tag: "padding", value: dims(d) });
export const mar = (d: number | number[]): Mod => ({ tag: "margin", value: dims(d) });
export const w = (width: number): Mod => ({ tag: "width", value: width });
export const h = (height: number): Mod => ({ tag: "height", value: height });
export const fillW: Mod = { tag: "fillWidth", value: true };
export const bg = (color: ColorToken, shape?: Shape): Mod => ({
  tag: "background",
  value: { color, shape },
});

// ── nodes ────────────────────────────────────────────────────────────────

export function Col(
  opts: { align?: HorizontalAlignment; arrange?: Arrangement; mods?: Mod[] },
  children: Node[],
): Node {
  return {
    tag: "Column",
    value: {
      modifiers: opts.mods ?? [],
      props: { horizontalAlignment: opts.align, verticalArrangement: opts.arrange },
      children,
    },
  };
}

export function RowN(
  opts: { align?: VerticalAlignment; arrange?: Arrangement; mods?: Mod[] },
  children: Node[],
): Node {
  return {
    tag: "Row",
    value: {
      modifiers: opts.mods ?? [],
      props: { verticalAlignment: opts.align, horizontalArrangement: opts.arrange },
      children,
    },
  };
}

export function BoxN(
  opts: { align?: ContentAlignment; mods?: Mod[] },
  children: Node[],
): Node {
  return {
    tag: "Box",
    value: {
      modifiers: opts.mods ?? [],
      props: { contentAlignment: opts.align },
      children,
    },
  };
}

export function Sp(mods?: Mod[]): Node {
  return { tag: "Spacer", value: { modifiers: mods ?? [], props: undefined, children: [] } };
}

export function Txt(
  text: string,
  style?: TypographyToken,
  color?: ColorToken,
  mods?: Mod[],
): Node {
  return {
    tag: "Text",
    value: {
      modifiers: mods ?? [],
      props: { style, color },
      children: [{ tag: "String", value: text }],
    },
  };
}

export function Btn(
  props: {
    text: string;
    variant?: ButtonVariant;
    clickAction?: string;
    loading?: boolean;
    enabled?: boolean;
  },
  mods?: Mod[],
): Node {
  return {
    tag: "Button",
    value: {
      modifiers: mods ?? [],
      props: {
        text: props.text,
        variant: props.variant,
        enabled: props.enabled,
        loading: props.loading,
        clickAction: props.clickAction,
      },
      children: [],
    },
  };
}
