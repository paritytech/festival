/**
 * Venue map rendering engine. Framework-agnostic wrapper around MapLibre GL JS.
 *
 * Data pipeline: Figma SVG → `scripts/convert-maps.py` → GeoJSON inlined via
 * Vite `?raw` import (no runtime fetch. Required for the iOS host sandbox).
 *
 * Coordinate model: GeoJSON coords are y-up SVG-viewbox units (the converter
 * flips at build time). The engine projects (x, y) → (lng, lat) centred on
 * (0, 0), scaled so the larger viewbox dimension maps to 7° of Mercator,
 * inside the safe zone, no projection warping.
 */
import type { Map as MLMap, StyleSpecification, ExpressionSpecification } from "maplibre-gl";
import type { VenueFloor, VenueMarker, VenueZone } from "../metadata/schemas";
import { getCategory, normalizeCategory, normalizeType } from "./categories";
import { getMarkerIcon, MARKER_ICONS, USER_PIN_SVG } from "./icons";

// Worker as a separate file (not a Blob URL). Required for the host iframe's
// strict CSP and sidesteps Vite's dep-optimizer blob-spawn quirk in dev. Paired
// with the CSP build of maplibre-gl imported dynamically below.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";

import venueGeoJSONRaw from "../public/floorplans/venue.geojson?raw";
import groundGeoJSONRaw from "../public/floorplans/block-b-first-ground.geojson?raw";
import firstFloorGeoJSONRaw from "../public/floorplans/block-b-first-floor.geojson?raw";
// Renders Figma effects MapLibre's style spec can't express (Gaussian blur on
// strokes, `plus-lighter` blend) on top of the outdoor canvas.
import buildingOverlaySvgRaw from "../public/floorplans/building-overlay.svg?raw";

export interface UserSpot {
  x: number;
  y: number;
  floorId: string;
}
export interface FocusOpts {
  bottomPadding?: number;
  targetZoomDelta?: number;
  animate?: boolean;
  sticky?: boolean;
}

export interface VenueMapHandle {
  setFloor(floor: VenueFloor): Promise<void>;
  setMarkers(markers: VenueMarker[]): void;
  setZones(zones: VenueZone[]): void;
  setSelectedMarker(markerId: string | null): void;
  setUserSpot(spot: UserSpot | null): void;
  setBottomNavHeight(px: number): void;
  focusMarker(markerId: string, opts?: FocusOpts): void;
  focusSpot(spot: UserSpot, opts?: FocusOpts): void;
  fitToFloor(): void;
  invalidateSize(): void;
  getZoneAt(svgX: number, svgY: number): string | null;
  /** True when `(svgX, svgY)` falls inside a zone tagged `#forbidden` on the
   *  current floor. Markers can legitimately exist outside any zone, so this
   *  is a stricter "is this point specifically off-limits?" check than
   *  `isPinDropAllowed`'s "is this point inside some non-forbidden zone?". */
  isPointInForbiddenZone(svgX: number, svgY: number): boolean;
  setTransitioning(value: boolean): void;
  flyToBuildingBounds(opts?: {
    duration?: number;
    maxZoomDelta?: number;
  }): Promise<boolean>;
  fadeFlash(direction: "in" | "out", durationMs: number): Promise<void>;
  enableZoomOutGesture(opts: {
    belowFitBy?: number;
    onTrigger: () => void;
  }): void;
  disableZoomOutGesture(): void;
  destroy(): void;
}

export interface VenueMapOptions {
  interactive?: boolean;
  bottomNavHeight?: number;
  blockOutOfBounds?: boolean;
  /** Fit strategy for the outdoor view.
   *   - `'cover'` (default, attendee): the venue fills the viewport on
   *     whichever axis is more constrained; the other axis extends past
   *     viewport (user pans to see cropped sides). Right for mobile/portrait
   *     viewports where the venue and viewport are both portrait.
   *   - `'contain'` (admin): the whole venue is visible at fit zoom with
   *     letterboxing on the unconstrained axis. Right for desktop/wide
   *     viewports where cover would push most of the venue off-screen
   *     vertically. */
  outdoorFit?: "cover" | "contain";
  onMarkerClick?: (marker: VenueMarker) => void;
  onMapClick?: (loc: { x: number; y: number; floorId: string }) => void;
  onBlockedClick?: (loc: { x: number; y: number; floorId: string }) => void;
  /** Click landed outside the floor's viewBox (letterbox area). */
  onVoidClick?: () => void;
  onBuildingClick?: () => void;
  onReady?: () => void;
}

// ── GeoJSON pipeline ──

interface ProjectedFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: {
    name?: string;
    tags: string[];
    id?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    fillOpacity?: number;
    strokeOpacity?: number;
    blur?: number;
    blend?: string;
    /** SVG-space coords kept on label features so the DOM-overlay renderer
     *  doesn't have to back-project from lng/lat on every move. */
    _svgPoint?: [number, number];
  };
}

interface ProjectedGeoJSON {
  type: "FeatureCollection";
  features: ProjectedFeature[];
  /** Viewbox dimensions from the source SVG. */
  _vbW: number;
  _vbH: number;
  /** Half the larger dimension × SCALE = degrees from origin to edge. */
  _scale: number;
  /** [[swLng, swLat], [neLng, neLat]]. For fitBounds. */
  _bounds: [[number, number], [number, number]];
  /** SVG viewbox corners projected to [lng, lat]. Used by the outdoor SVG
   *  overlay sync to anchor the matrix transform. */
  _svgAnchors: {
    W: number;
    H: number;
    topLeft: [number, number];
    topRight: [number, number];
    bottomLeft: [number, number];
    bottomRight: [number, number];
  };
}

/** Project GeoJSON coordinates from SVG viewbox units to MapLibre lng/lat,
 *  centred on (0, 0). The largest viewbox dimension maps to 7° of arc. Well
 *  inside Mercator's safe zone, no projection warping. */
function projectGeoJSON(raw: string): ProjectedGeoJSON {
  const gj = JSON.parse(raw) as {
    features: ProjectedFeature[];
    metadata?: { viewbox_width?: number; viewbox_height?: number };
  };
  const VB_W = Number(gj.metadata?.viewbox_width ?? 0);
  const VB_H = Number(gj.metadata?.viewbox_height ?? 0);
  if (!VB_W || !VB_H) {
    throw new Error(
      "venue map: GeoJSON missing viewbox dimensions in metadata",
    );
  }
  const SCALE = 7.0 / Math.max(VB_W, VB_H);

  // GeoJSON coords are already Y-flipped at convert time (y grows upward to
  // match lat orientation), so we just centre and scale. NO negation. The
  // `_svgAnchors` below intentionally do negate because they operate on raw
  // (y-down) SVG-pixel coordinates instead. Negating twice would render
  // every feature vertically mirrored relative to the SVG overlay, which
  // misplaces labels and breaks the hit-test layer used for building clicks.
  const projectPoint = (p: [number, number]): [number, number] => [
    (p[0] - VB_W / 2) * SCALE,
    (p[1] - VB_H / 2) * SCALE,
  ];

  const projectCoords = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
      return projectPoint(coords as [number, number]);
    }
    return coords.map(projectCoords);
  };

  const features = gj.features.map((f) => {
    const newGeom = {
      ...f.geometry,
      coordinates: projectCoords(
        (f.geometry as GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point)
          .coordinates,
      ),
    } as GeoJSON.Geometry;
    const props = { ...f.properties };
    if (f.geometry.type === "Point") {
      const [x, y] = (f.geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ];
      props._svgPoint = [x, y];
    }
    return { ...f, geometry: newGeom, properties: props } as ProjectedFeature;
  });

  const minLng = (-VB_W / 2) * SCALE;
  const maxLng = (VB_W / 2) * SCALE;
  const minLat = (-VB_H / 2) * SCALE;
  const maxLat = (VB_H / 2) * SCALE;

  return {
    type: "FeatureCollection",
    features,
    _vbW: VB_W,
    _vbH: VB_H,
    _scale: SCALE,
    _bounds: [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    _svgAnchors: {
      W: VB_W,
      H: VB_H,
      topLeft: [(0 - VB_W / 2) * SCALE, -(0 - VB_H / 2) * SCALE],
      topRight: [(VB_W - VB_W / 2) * SCALE, -(0 - VB_H / 2) * SCALE],
      bottomLeft: [(0 - VB_W / 2) * SCALE, -(VB_H - VB_H / 2) * SCALE],
      bottomRight: [(VB_W - VB_W / 2) * SCALE, -(VB_H - VB_H / 2) * SCALE],
    },
  };
}

const GEOJSON_BY_FLOOR = new Map<string, () => ProjectedGeoJSON>([
  ["venue", () => projectGeoJSON(venueGeoJSONRaw)],
  ["block-b-first-ground", () => projectGeoJSON(groundGeoJSONRaw)],
  ["block-b-first-floor", () => projectGeoJSON(firstFloorGeoJSONRaw)],
]);

const projectedCache = new Map<string, ProjectedGeoJSON>();
function getProjected(floorId: string): ProjectedGeoJSON {
  const cached = projectedCache.get(floorId);
  if (cached) return cached;
  const loader = GEOJSON_BY_FLOOR.get(floorId);
  if (!loader) {
    throw new Error(`venue map: no GeoJSON registered for floor "${floorId}"`);
  }
  const projected = loader();
  projectedCache.set(floorId, projected);
  return projected;
}

function isOutdoorFloor(floorId: string): boolean {
  return floorId === "venue";
}

/** `'site'` renders the outdoor map in source order through MapLibre and keeps
 *  only the main building as a small synced SVG overlay; `'floor'` renders
 *  indoor zones/structure/scenery/decoration directly via MapLibre. */
function makeStyle(
  projected: ProjectedGeoJSON,
  kind: "site" | "floor",
): StyleSpecification {
  const sourceData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: projected.features as unknown as GeoJSON.Feature[],
  };

  if (kind === "site") {
    const isBuilding = ["in", "main-building", ["get", "tags"]] as ExpressionSpecification;
    return {
      version: 8,
      sources: {
        venue: { type: "geojson", data: sourceData },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#141414" } },
        {
          id: "site-fill",
          type: "fill",
          source: "venue",
          filter: [
            "all",
            ["==", ["geometry-type"], "Polygon"],
            ["!", isBuilding],
            ["has", "fill"],
          ],
          paint: {
            "fill-antialias": false,
            "fill-color": ["get", "fill"],
            "fill-opacity": ["coalesce", ["get", "fillOpacity"], 1],
          },
        },
        {
          id: "site-line",
          type: "line",
          source: "venue",
          filter: ["all", ["!", isBuilding], ["has", "stroke"]],
          layout: {
            "line-cap": "butt",
            "line-join": "bevel",
          },
          paint: {
            "line-color": ["get", "stroke"],
            "line-opacity": ["coalesce", ["get", "strokeOpacity"], 1],
            "line-width": [
              "interpolate",
              ["exponential", 2],
              ["zoom"],
              0,
              ["*", ["coalesce", ["get", "strokeWidth"], 1], 0.00355],
              16,
              ["*", ["coalesce", ["get", "strokeWidth"], 1], 233],
            ],
          },
        },
        {
          id: "zones-hit",
          type: "fill",
          source: "venue",
          filter: ["in", "zone", ["get", "tags"]],
          paint: { "fill-color": "#000", "fill-opacity": 0 },
        },
        {
          id: "main-building-hit",
          type: "fill",
          source: "venue",
          filter: [
            "all",
            isBuilding,
            ["==", ["geometry-type"], "Polygon"],
          ],
          paint: { "fill-color": "#000", "fill-opacity": 0 },
        },
      ],
    };
  }

  // Floor plan layer order: zones → walls/scenery fills → wall lines → decoration.
  // `structure-line` filters to LineStrings only on purpose: filled wall
  // polygons would otherwise gain a phantom outline equal to their authored
  // stroke width, thickening every wall visibly.
  return {
    version: 8,
    sources: {
      venue: { type: "geojson", data: sourceData },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#141414" } },
      {
        id: "zones",
        type: "fill",
        source: "venue",
        filter: ["in", "zone", ["get", "tags"]],
        paint: {
          "fill-color": ["coalesce", ["get", "fill"], "#CCCCCC"],
          "fill-opacity": 0.85,
        },
      },
      {
        id: "structure-fill",
        type: "fill",
        source: "venue",
        filter: [
          "all",
          ["in", "structure", ["get", "tags"]],
          ["==", ["geometry-type"], "Polygon"],
        ],
        paint: {
          "fill-color": ["coalesce", ["get", "fill"], "#313131"],
        },
      },
      {
        id: "scenery-fill",
        type: "fill",
        source: "venue",
        filter: [
          "all",
          ["in", "scenery", ["get", "tags"]],
          ["==", ["geometry-type"], "Polygon"],
        ],
        paint: {
          "fill-color": ["coalesce", ["get", "fill"], "#262626"],
        },
      },
      {
        id: "structure-line",
        type: "line",
        source: "venue",
        filter: [
          "all",
          ["in", "structure", ["get", "tags"]],
          ["!", ["in", "main-building", ["get", "tags"]]],
          [
            "in",
            ["geometry-type"],
            ["literal", ["LineString", "MultiLineString"]],
          ],
        ],
        paint: {
          "line-color": ["coalesce", ["get", "stroke"], "#313131"],
          // Zoom-interpolated thickness so walls track the floor's apparent
          // scale instead of being a constant screen-pixel width.
          "line-width": [
            "interpolate",
            ["exponential", 2],
            ["zoom"],
            0,
            ["*", ["coalesce", ["get", "strokeWidth"], 1], 0.00355],
            16,
            ["*", ["coalesce", ["get", "strokeWidth"], 1], 233],
          ],
        },
      },
      {
        id: "decoration",
        type: "line",
        source: "venue",
        filter: ["in", "decoration", ["get", "tags"]],
        paint: {
          "line-color": "rgba(255, 255, 255, 0.35)",
          "line-width": [
            "interpolate",
            ["exponential", 2],
            ["zoom"],
            0,
            ["*", ["coalesce", ["get", "strokeWidth"], 1], 0.0018],
            16,
            ["*", ["coalesce", ["get", "strokeWidth"], 1], 117],
          ],
        },
      },
    ],
  };
}

// dotli serves our app through a service worker, which returns the worker file
// without the Cross-Origin-* headers the origin sets; the document's COEP then
// makes the browser reject it as a worker (NS_ERROR_BLOCKED_BY_POLICY). A
// controlling service worker is unique to dotli here — electron and wkwebview
// load the bundle directly, with none — so only there do we run the worker from
// a same-origin Blob URL, which bypasses the service worker.
let resolvedWorkerUrl: string | null = null;
async function resolveMaplibreWorkerUrl(): Promise<string> {
  if (resolvedWorkerUrl) return resolvedWorkerUrl;
  if (navigator.serviceWorker?.controller) {
    try {
      const res = await fetch(maplibreWorkerUrl);
      resolvedWorkerUrl = URL.createObjectURL(await res.blob());
      return resolvedWorkerUrl;
    } catch {
      // Fall back to the file URL below.
    }
  }
  resolvedWorkerUrl = maplibreWorkerUrl;
  return resolvedWorkerUrl;
}

export async function createVenueMap(
  container: HTMLElement,
  opts: VenueMapOptions = {},
): Promise<VenueMapHandle> {
  const mod = await import("maplibre-gl/dist/maplibre-gl-csp");
  const maplibregl: typeof import("maplibre-gl") = mod.default ?? mod;
  maplibregl.setWorkerUrl(await resolveMaplibreWorkerUrl());

  container.classList.add("venue-map");
  if (!opts.interactive) container.classList.add("is-static");

  // Sized to the outdoor building footprint each frame. Gives e2e a stable
  // `[data-testid]` anchor even though the building is a canvas feature, not
  // a DOM node. `pointer-events: none` (see map.css) keeps real wheel/click
  // events falling through to the canvas underneath.
  const buildingTargetEl = document.createElement("div");
  buildingTargetEl.className = "venue-map__building-target";
  buildingTargetEl.dataset.testid = "building-tap-target";
  buildingTargetEl.setAttribute("aria-hidden", "true");
  buildingTargetEl.style.display = "none";
  buildingTargetEl.addEventListener("click", () => opts.onBuildingClick?.());
  container.appendChild(buildingTargetEl);

  // Outdoor building SVG overlay. Hidden on floor views, sync'd to MapLibre's
  // transform via CSS matrix() on every move. The rest of the outdoor map is
  // rendered through MapLibre; this SVG preserves the building's Figma glow.
  const overlayHostEl = document.createElement("div");
  overlayHostEl.className = "venue-map__overlay-host";
  overlayHostEl.setAttribute("aria-hidden", "true");
  overlayHostEl.style.display = "none";
  overlayHostEl.innerHTML = buildingOverlaySvgRaw;
  const overlaySvgEl = overlayHostEl.querySelector<SVGSVGElement>("svg");
  if (overlaySvgEl) {
    // CSS size must match the viewBox so the matrix() transform operates in
    // (0,0)..(viewBoxW, viewBoxH) space. Otherwise the basis vectors are
    // off by the CSS-vs-intrinsic scale factor and the overlay drifts.
    const vbAttr = (overlaySvgEl.getAttribute("viewBox") ?? "")
      .split(/\s+/)
      .map(Number);
    const vbW = Number.isFinite(vbAttr[2])
      ? vbAttr[2]!
      : Number(overlaySvgEl.getAttribute("width") ?? 0);
    const vbH = Number.isFinite(vbAttr[3])
      ? vbAttr[3]!
      : Number(overlaySvgEl.getAttribute("height") ?? 0);
    overlaySvgEl.setAttribute("preserveAspectRatio", "none");
    overlaySvgEl.classList.add("venue-map__overlay-svg");
    overlaySvgEl.style.position = "absolute";
    overlaySvgEl.style.left = "0";
    overlaySvgEl.style.top = "0";
    overlaySvgEl.style.width = `${vbW}px`;
    overlaySvgEl.style.height = `${vbH}px`;
    overlaySvgEl.style.transformOrigin = "0 0";
    overlaySvgEl.style.willChange = "transform";
  }
  container.appendChild(overlayHostEl);

  // Flash overlay used by the host page's enter/exit choreography.
  const flashEl = document.createElement("div");
  flashEl.className = "venue-map__flash";
  flashEl.setAttribute("aria-hidden", "true");
  container.appendChild(flashEl);

  const labelsEl = document.createElement("div");
  labelsEl.className = "venue-map__labels";
  labelsEl.setAttribute("aria-hidden", "true");
  container.appendChild(labelsEl);

  // Per-category marker panes; stacking order is the CSS z-index on
  // `.venue-map__pane[data-pane=...]`.
  const MARKER_PANES = [
    "marker-scenery",
    "marker-emergency",
    "marker-money",
    "marker-service",
    "marker-base",
    "marker-food",
    "marker-activations",
  ] as const;
  type PaneName = (typeof MARKER_PANES)[number];
  const PANE_BY_CATEGORY: Record<string, PaneName> = {
    base: "marker-base",
    food: "marker-food",
    activations: "marker-activations",
    service: "marker-service",
    emergency: "marker-emergency",
    money: "marker-money",
    scenery: "marker-scenery",
  };
  const markersRoot = document.createElement("div");
  markersRoot.className = "venue-map__markers";
  markersRoot.setAttribute("aria-hidden", "true");
  const paneByName = new Map<PaneName, HTMLDivElement>();
  for (const name of MARKER_PANES) {
    const pane = document.createElement("div");
    pane.className = "venue-map__pane";
    pane.dataset.pane = name;
    markersRoot.appendChild(pane);
    paneByName.set(name, pane);
  }
  container.appendChild(markersRoot);

  // Initial floor must be set via setFloor() before the map is useful. To keep
  // construction simple we start on `venue` (outdoor) with an empty style.
  const initial = getProjected("venue");
  const interactive = opts.interactive ?? true;

  // Initialize with a minimal *empty* style. The first `setFloor()` call sets
  // the real style and the `styledata` event fires reliably. If we instead
  // initialized with the outdoor style and `setFloor('venue')` later set the
  // same style, MapLibre's diff-aware setStyle would see no change and
  // styledata would never fire. Making the setFloor's await hang.
  const EMPTY_STYLE: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [],
  };
  const map: MLMap = new maplibregl.Map({
    container,
    style: EMPTY_STYLE,
    bounds: initial._bounds,
    fitBoundsOptions: { padding: 0, animate: false },
    minZoom: -2,
    maxZoom: 22,
    renderWorldCopies: false,
    pitch: 0,
    maxPitch: 0,
    pitchWithRotate: false,
    attributionControl: false,
    interactive,
  });

  // Surface any maplibre error so it doesn't get swallowed by the dynamic-
  // import promise chain. These only fire on real engine-level failures
  // (e.g. style validation, tile load errors, WebGL context loss).
  map.on("error", (e) => {
    console.error("[venue-map] maplibre error", e && (e.error ?? e));
  });

  let currentFloor: VenueFloor | null = null;
  let currentKind: "site" | "floor" = "site";
  let projected: ProjectedGeoJSON = initial;
  let mainBuildingBBox: [[number, number], [number, number]] | null = null;
  let fitZoom = 0;
  let transitioning = false;
  let bottomNavHeight = opts.bottomNavHeight ?? 0;
  /** Set true while applyFit / coverFit / flyTo* / focus* is running. The
   *  camera-center clamp below ignores these programmatic camera moves so it
   *  doesn't fight intentional jumps (e.g., the cover fit's latShift). */
  let isApplyingCameraIntent = false;

  // Pinch-out-to-exit gesture: when armed, a user pinch/wheel past
  // `fitZoom - belowFitBy * 0.5` fires `onTrigger` once and self-disarms.
  let zoomOutGesture: { belowFitBy: number; onTrigger: () => void } | null =
    null;
  function onZoomEventForGesture(): void {
    if (!zoomOutGesture) return;
    // Skip programmatic zoom changes (floor switches, focus, applyFit).
    // Otherwise switching to a floor whose fit zoom is below the previous
    // floor's threshold fires the gesture during the fit transition.
    if (isApplyingCameraIntent) return;
    if (map.getZoom() < fitZoom - zoomOutGesture.belowFitBy * 0.5) {
      const trigger = zoomOutGesture.onTrigger;
      zoomOutGesture = null;
      map.off("zoom", onZoomEventForGesture);
      trigger();
    }
  }

  type StickyFocus =
    | { kind: "marker"; markerId: string; opts: FocusOpts }
    | { kind: "spot"; spot: UserSpot; opts: FocusOpts };
  let stickyFocus: StickyFocus | null = null;

  const labelEntries: Array<{ el: HTMLDivElement; lng: number; lat: number }> =
    [];

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === '"'
              ? "&quot;"
              : "&#39;",
    );
  }

  function slugify(name: string | undefined): string | null {
    if (!name) return null;
    const s = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || null;
  }

  function unionBounds(
    boxes: Array<[[number, number], [number, number]] | null>,
  ): [[number, number], [number, number]] | null {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    let any = false;
    for (const box of boxes) {
      if (!box) continue;
      if (box[0][0] < minLng) minLng = box[0][0];
      if (box[0][1] < minLat) minLat = box[0][1];
      if (box[1][0] > maxLng) maxLng = box[1][0];
      if (box[1][1] > maxLat) maxLat = box[1][1];
      any = true;
    }
    return any
      ? [
          [minLng, minLat],
          [maxLng, maxLat],
        ]
      : null;
  }

  /** Min/max lng+lat bounds for a Polygon / MultiPolygon / Point geometry, or
   *  null when the geometry isn't bounded (e.g. empty). */
  function featureBounds(
    geom: GeoJSON.Geometry,
  ): [[number, number], [number, number]] | null {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    let any = false;
    const visit = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === "number") {
        const [lng, lat] = coords as [number, number];
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
        any = true;
        return;
      }
      for (const c of coords) visit(c);
    };
    if (
      geom.type === "Polygon" ||
      geom.type === "MultiPolygon" ||
      geom.type === "LineString" ||
      geom.type === "MultiLineString" ||
      geom.type === "Point"
    ) {
      visit((geom as { coordinates: unknown }).coordinates);
    }
    if (!any) return null;
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }

  function rebuildLabels(): void {
    for (const { el } of labelEntries) el.remove();
    labelEntries.length = 0;

    for (const feat of projected.features) {
      const tags = feat.properties.tags ?? [];
      if (!tags.includes("label")) continue;
      if (feat.geometry.type !== "Point") continue;
      const text = feat.properties.name ?? "";
      if (!text) continue;
      const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ];

      const el = document.createElement("div");
      el.className = "venue-label";
      const lines = text
        .split("\n")
        .map((line) => `<span>${escapeHtml(line)}</span>`)
        .join("");
      el.innerHTML = `<div class="venue-label__inner">${lines}</div>`;
      labelsEl.appendChild(el);
      labelEntries.push({ el, lng, lat });
    }
    positionLabels();
  }

  let labelRaf: number | null = null;
  function positionLabels(): void {
    for (const entry of labelEntries) {
      const { x, y } = map.project([entry.lng, entry.lat]);
      entry.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
  function scheduleLabelSync(): void {
    if (labelRaf !== null) return;
    labelRaf = requestAnimationFrame(() => {
      labelRaf = null;
      positionLabels();
      positionMarkers();
      positionUserPin();
      syncOverlay();
      positionBuildingTarget();
    });
  }

  interface MarkerEntry {
    el: HTMLDivElement;
    lng: number;
    lat: number;
    marker: VenueMarker;
  }
  const markerEntries = new Map<string, MarkerEntry>();
  let markers: VenueMarker[] = [];
  let zones: VenueZone[] = [];
  let selectedMarkerId: string | null = null;

  /** Single "you are here" pin. */
  let userPin: { el: HTMLDivElement; lng: number; lat: number } | null = null;

  /** Progressive marker reveal. Tier 0 hides all, tier 4 shows everything. */
  function computeTier(zoom: number): 0 | 1 | 2 | 3 | 4 {
    const d = zoom - fitZoom;
    if (d < 0.25) return 0;
    if (d < 0.75) return 1;
    if (d < 1.25) return 2;
    if (d < 1.75) return 3;
    return 4;
  }
  function updateZoomTier(): void {
    container.dataset.zoomTier = String(computeTier(map.getZoom()));
  }

  // Raw SVG coords are y-down (origin top-left); the converter flipped
  // GeoJSON to y-up. Both helpers below project to / from the same lng/lat
  // space so admin/picker SVG inputs and GeoJSON features stay aligned.
  function svgPointToLngLat(x: number, y: number): [number, number] {
    const SCALE = projected._scale;
    const lng = (x - projected._vbW / 2) * SCALE;
    const lat = -(y - projected._vbH / 2) * SCALE;
    return [lng, lat];
  }

  function lngLatToSvgPoint(
    lng: number,
    lat: number,
  ): { x: number; y: number } {
    const SCALE = projected._scale;
    const x = lng / SCALE + projected._vbW / 2;
    const y = -lat / SCALE + projected._vbH / 2;
    return { x, y };
  }

  // Ray-casting point-in-polygon, hand-rolled to avoid adding @turf.
  function pointInRing(px: number, py: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi || 1) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(
    px: number,
    py: number,
    rings: number[][][],
  ): boolean {
    if (rings.length === 0) return false;
    // First ring is outer; subsequent are holes.
    if (!pointInRing(px, py, rings[0]!)) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(px, py, rings[i]!)) return false;
    }
    return true;
  }

  /** True when `(svgX, svgY)` falls inside a `#zone` feature that is NOT
   *  `#forbidden`. Used when `blockOutOfBounds` is on (attendee). */
  function isPinDropAllowed(svgX: number, svgY: number): boolean {
    const [lng, lat] = svgPointToLngLat(svgX, svgY);
    for (const feat of projected.features) {
      const tags = feat.properties.tags ?? [];
      if (!tags.includes("zone")) continue;
      if (tags.includes("forbidden")) continue;
      const geom = feat.geometry;
      if (geom.type === "Polygon") {
        if (pointInPolygon(lng, lat, geom.coordinates as number[][][]))
          return true;
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates as number[][][][]) {
          if (pointInPolygon(lng, lat, poly)) return true;
        }
      }
    }
    return false;
  }

  function isPointInForbiddenZone(svgX: number, svgY: number): boolean {
    const [lng, lat] = svgPointToLngLat(svgX, svgY);
    for (const feat of projected.features) {
      const tags = feat.properties.tags ?? [];
      if (!tags.includes("zone")) continue;
      if (!tags.includes("forbidden")) continue;
      const geom = feat.geometry;
      if (geom.type === "Polygon") {
        if (pointInPolygon(lng, lat, geom.coordinates as number[][][]))
          return true;
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates as number[][][][]) {
          if (pointInPolygon(lng, lat, poly)) return true;
        }
      }
    }
    return false;
  }

  function buildMarkerHtml(m: VenueMarker): string {
    const category = normalizeCategory(m.category);
    const type = normalizeType(category, m.type);
    const glyph = getMarkerIcon(category, type);
    if (!MARKER_ICONS[`${category}/${type}`]) {
      // Loud warning so missing icons surface in dev instead of silently
      // falling back to base/room.
      // eslint-disable-next-line no-console
      console.warn(
        `[venue map] no MARKER_ICONS entry for ${category}/${type} — using base/room fallback`,
      );
    }
    return `<div class="vmarker" data-category="${category}" data-type="${type}" data-marker-id="${escapeHtml(m.id)}">
      <span class="vmarker__icon" aria-hidden="true">${glyph}</span>
    </div>`;
  }

  function renderMarkers(): void {
    if (!currentFloor) return;
    const floorMarkers = markers.filter((m) => m.floorId === currentFloor!.id);
    const nextIds = new Set(floorMarkers.map((m) => m.id));

    for (const [id, entry] of markerEntries) {
      if (!nextIds.has(id)) {
        entry.el.remove();
        markerEntries.delete(id);
      }
    }

    for (const m of floorMarkers) {
      const [lng, lat] = svgPointToLngLat(m.x, m.y);
      const category = normalizeCategory(m.category);
      const paneName = PANE_BY_CATEGORY[category] ?? "marker-base";
      const pane = paneByName.get(paneName)!;

      const existing = markerEntries.get(m.id);
      if (existing) {
        existing.lng = lng;
        existing.lat = lat;
        existing.marker = m;
        existing.el.innerHTML = buildMarkerHtml(m);
        wireMarkerClicks(existing.el, m);
        if (existing.el.parentElement !== pane) pane.appendChild(existing.el);
        continue;
      }

      const root = document.createElement("div");
      root.className = `vmarker-root vmarker-root--${category}`;
      root.innerHTML = buildMarkerHtml(m);
      pane.appendChild(root);
      wireMarkerClicks(root, m);
      markerEntries.set(m.id, { el: root, lng, lat, marker: m });
    }

    applySelectedClass();
    positionMarkers();
  }

  function wireMarkerClicks(rootEl: HTMLElement, m: VenueMarker): void {
    const inner = rootEl.querySelector<HTMLElement>(".vmarker");
    if (!inner) return;
    inner.addEventListener("click", (e) => {
      if (transitioning) return;
      e.stopPropagation();
      opts.onMarkerClick?.(m);
    });
  }

  function positionMarkers(): void {
    for (const entry of markerEntries.values()) {
      const { x, y } = map.project([entry.lng, entry.lat]);
      entry.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  function applySelectedClass(): void {
    for (const [id, entry] of markerEntries) {
      const inner = entry.el.querySelector<HTMLElement>(".vmarker");
      if (!inner) continue;
      inner.classList.toggle("is-selected", id === selectedMarkerId);
    }
  }

  /** Zone id of the currently selected marker (or null), driving the
   *  active/dimmed paint properties on the floor zones layer. */
  function activeZoneId(): string | null {
    if (!selectedMarkerId) return null;
    const m = markers.find((x) => x.id === selectedMarkerId);
    return m?.zoneId ?? null;
  }

  function applyZoneHighlight(): void {
    if (!currentFloor) return;
    if (currentKind !== "floor") return;
    if (!map.getLayer("zones")) return;
    const activeId = activeZoneId();
    const floorZoneIds = zones
      .filter((z) => z.floorId === currentFloor!.id)
      .map((z) => z.id);
    if (activeId && floorZoneIds.includes(activeId)) {
      map.setPaintProperty("zones", "fill-opacity", [
        "case",
        ["==", ["get", "id"], activeId],
        0.95,
        0.15,
      ]);
    } else {
      map.setPaintProperty("zones", "fill-opacity", 0.85);
    }
  }

  function renderUserSpot(spot: UserSpot | null): void {
    if (!spot || !currentFloor || spot.floorId !== currentFloor.id) {
      if (userPin) {
        userPin.el.remove();
        userPin = null;
      }
      return;
    }
    const [lng, lat] = svgPointToLngLat(spot.x, spot.y);
    if (userPin) {
      userPin.lng = lng;
      userPin.lat = lat;
      positionUserPin();
      return;
    }
    const el = document.createElement("div");
    el.className = "vpin-root";
    el.innerHTML = `<div class="vpin">${USER_PIN_SVG}</div>`;
    container.appendChild(el);
    userPin = { el, lng, lat };
    positionUserPin();
  }
  function positionUserPin(): void {
    if (!userPin) return;
    const { x, y } = map.project([userPin.lng, userPin.lat]);
    userPin.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Build a 2D CSS matrix taking (0,0)→topLeft, (W,0)→topRight, (0,H)→
   *  bottomLeft in screen pixels. Rotation is encoded in the basis vectors;
   *  the same code handles any bearing. */
  function syncOverlay(): void {
    if (!overlaySvgEl) return;
    if (overlayHostEl.style.display === "none") return;
    const a = projected._svgAnchors;
    const tl = map.project(a.topLeft);
    const tr = map.project(a.topRight);
    const bl = map.project(a.bottomLeft);
    const W = a.W,
      H = a.H;
    const m11 = (tr.x - tl.x) / W;
    const m12 = (tr.y - tl.y) / W;
    const m21 = (bl.x - tl.x) / H;
    const m22 = (bl.y - tl.y) / H;
    overlaySvgEl.style.transform = `matrix(${m11}, ${m12}, ${m21}, ${m22}, ${tl.x}, ${tl.y})`;
  }

  function setOverlayVisible(visible: boolean): void {
    overlayHostEl.style.display = visible ? "" : "none";
    buildingTargetEl.style.display = visible ? "" : "none";
    if (visible) {
      syncOverlay();
      positionBuildingTarget();
    }
  }

  /** Filled-polygon features tagged `main-building`. LineString halos
   *  (the dark-blur and outer-glow strokes around the building) have
   *  bboxes that extend far past the visible footprint, so they're
   *  intentionally excluded. */
  function mainBuildingFootprintFeatures(): ProjectedFeature[] {
    return projected.features.filter((f) => {
      if (!(f.properties.tags ?? []).includes("main-building")) return false;
      return (
        f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
      );
    });
  }

  function positionBuildingTarget(): void {
    if (currentKind !== "site") return;
    const bbox = mainBuildingBBox;
    if (!bbox) return;
    const tl = map.project([bbox[0][0], bbox[1][1]]);
    const br = map.project([bbox[1][0], bbox[0][1]]);
    const left = Math.min(tl.x, br.x);
    const top = Math.min(tl.y, br.y);
    const width = Math.abs(br.x - tl.x);
    const height = Math.abs(br.y - tl.y);
    buildingTargetEl.style.transform = `translate(${left}px, ${top}px)`;
    buildingTargetEl.style.width = `${width}px`;
    buildingTargetEl.style.height = `${height}px`;
  }
  // No click listener. The element is `pointer-events: none` so clicks
  // (including Playwright's e2e clicks) fall through to the canvas where the
  // map's own `click` listener picks them up via queryRenderedFeatures.

  function applyFit(): boolean {
    map.resize();
    // Use CSS pixels (container layout size), not the canvas buffer's device
    // pixels. MapLibre's zoom math is defined in CSS-pixel space. Using the
    // buffer dimensions (canvas.width / canvas.height) would scale zoom by
    // devicePixelRatio and over-zoom on HiDPI / mobile-emulated viewports.
    const cssW = container.offsetWidth;
    const cssH = container.offsetHeight;
    if (cssW <= 0 || cssH <= 0) return false;

    // Don't let the camera-centre clamp fight our own fit (cover-fit's
    // latShift may legitimately push the centre near the bounds edge).
    isApplyingCameraIntent = true;

    // Lift any prior minZoom before fitting. FitBounds respects minZoom and
    // would otherwise leave the camera at the previous floor's zoom when
    // transitioning to a larger floor. Re-applied post-fit. No setMaxBounds
    // here: when the floor extent is smaller than the viewport (contain-fit's
    // slack axis), MapLibre's setMaxBounds auto-zooms in to fit the viewport
    // inside bounds, fighting the fit. updatePanLock + clampCameraCenter are
    // the actual "can't drift off-screen" guards.
    map.setMinZoom(-2);

    const bottomHidden = computeBottomHidden();
    const scaleX = cssW / projected._vbW;
    const scaleY = cssH / projected._vbH;
    const padXPx = Math.max(0, (currentFloor?.fitPaddingX ?? 0) * scaleX);
    const padYPx = Math.max(0, (currentFloor?.fitPaddingY ?? 0) * scaleY);

    const isOutdoor = currentFloor ? isOutdoorFloor(currentFloor.id) : false;
    const useCover = isOutdoor && (opts.outdoorFit ?? "cover") === "cover";
    if (useCover) {
      coverFit(cssW, cssH, bottomHidden, padXPx, padYPx);
    } else {
      map.fitBounds(projected._bounds, {
        padding: {
          top: padYPx,
          bottom: bottomHidden + padYPx,
          left: padXPx,
          right: padXPx,
        },
        animate: false,
        duration: 0,
      });
    }
    fitZoom = map.getZoom();
    // Clamp pinch-out to fit zoom, UNLESS a zoom-out gesture is armed
    // (picker uses this to detect indoor→outdoor pinch).
    map.setMinZoom(
      zoomOutGesture ? fitZoom - zoomOutGesture.belowFitBy : fitZoom,
    );
    updatePanLock();
    updateLabelScale();
    isApplyingCameraIntent = false;
    return true;
  }

  /** Pulls the camera centre back so the viewport stays inside the floor's
   *  projected bounds. At any zoom, the centre is allowed in
   *  `[boundsMin + halfViewport, boundsMax - halfViewport]`; if the viewport
   *  exceeds bounds on an axis (contain-fit's slack axis), the centre pins
   *  to the bounds midpoint. */
  const TILE_SIZE_DEFAULT = 512;
  function clampCameraCenter(): void {
    if (!currentFloor || transitioning || isApplyingCameraIntent) return;
    const c = map.getCenter();
    const z = map.getZoom();
    const pxPerDeg = (TILE_SIZE_DEFAULT * Math.pow(2, z)) / 360;
    const cssW = container.offsetWidth;
    const cssH = container.offsetHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const halfLngSpan = cssW / 2 / pxPerDeg;
    const halfLatSpan = cssH / 2 / pxPerDeg;
    const b = projected._bounds;
    const allowMinLng = b[0][0] + halfLngSpan;
    const allowMaxLng = b[1][0] - halfLngSpan;
    const allowMinLat = b[0][1] + halfLatSpan;
    const allowMaxLat = b[1][1] - halfLatSpan;
    const midLng = (b[0][0] + b[1][0]) / 2;
    const midLat = (b[0][1] + b[1][1]) / 2;
    const lng =
      allowMinLng >= allowMaxLng
        ? midLng
        : Math.max(allowMinLng, Math.min(allowMaxLng, c.lng));
    const lat =
      allowMinLat >= allowMaxLat
        ? midLat
        : Math.max(allowMinLat, Math.min(allowMaxLat, c.lat));
    if (lng !== c.lng || lat !== c.lat) {
      // Glide the correction instead of teleporting, so zooming/panning into
      // a border rubber-bands back like a native map. Guard re-entry so the
      // ease's own moveend doesn't re-trigger this clamp.
      isApplyingCameraIntent = true;
      map.once("moveend", () => {
        isApplyingCameraIntent = false;
      });
      map.easeTo({ center: [lng, lat], duration: 150, essential: true });
    }
  }

  /** Linearly scales the zone-label font size from LABEL_MIN_PX at fit zoom
   *  to LABEL_MAX_PX at fitZoom+ZOOM_RANGE. Written to a CSS variable on
   *  the container. */
  function updateLabelScale(): void {
    if (!currentFloor) return;
    const LABEL_MIN_PX = 6;
    const LABEL_MAX_PX = 8;
    const ZOOM_RANGE = 4; // zoom levels above fit at which we hit LABEL_MAX_PX
    const t = Math.max(0, Math.min(1, (map.getZoom() - fitZoom) / ZOOM_RANGE));
    const size = LABEL_MIN_PX + (LABEL_MAX_PX - LABEL_MIN_PX) * t;
    container.style.setProperty("--venue-label-size", `${size.toFixed(2)}px`);
  }

  /** Disables drag panning while the camera is at (or below) the floor's
   *  natural fit zoom; re-enables once the user zooms in. Skipped entirely
   *  when the map was created with `interactive: false` so focus animations
   *  on preview tiles don't accidentally re-enable dragPan. */
  function updatePanLock(): void {
    if (!interactive) return;
    const PAN_THRESHOLD = 0.01;
    const zoomedIn = map.getZoom() > fitZoom + PAN_THRESHOLD;
    if (zoomedIn) map.dragPan.enable();
    else map.dragPan.disable();
  }

  /** Manual cover fit. Uses `max(zoomW, zoomH)` so the viewport is filled
   *  on whichever axis is more constrained (the other gets cropped).
   *  fitBounds is "contain" (min), which leaves letterboxing. Camera centre
   *  also shifts up by half of `bottomHidden` so the venue's geometric
   *  centre lands in the *visible* viewport (not the canvas centre, which
   *  would put half the content under a mobile bottom nav). */
  function coverFit(
    cssW: number,
    cssH: number,
    bottomHidden: number,
    padXPx: number,
    padYPx: number,
  ): void {
    const effectiveW = Math.max(1, cssW - 2 * padXPx);
    const effectiveH = Math.max(1, cssH - bottomHidden - 2 * padYPx);
    const lngSpan = projected._bounds[1][0] - projected._bounds[0][0];
    const latSpan = projected._bounds[1][1] - projected._bounds[0][1];
    const centerLng = (projected._bounds[0][0] + projected._bounds[1][0]) / 2;
    const centerLat = (projected._bounds[0][1] + projected._bounds[1][1]) / 2;
    const TILE = 512;
    const zoomW = Math.log2((effectiveW * 360) / (lngSpan * TILE));
    const zoomH = Math.log2((effectiveH * 360) / (latSpan * TILE));
    const target = Math.max(zoomW, zoomH);
    const degPerPx = 360 / (TILE * Math.pow(2, target));
    const latShift = (bottomHidden / 2) * degPerPx;
    map.jumpTo({ center: [centerLng, centerLat - latShift], zoom: target });
  }

  function tinyBoundsAround(
    lng: number,
    lat: number,
  ): [[number, number], [number, number]] {
    const padScale =
      projected._scale * Math.max(projected._vbW, projected._vbH) * 0.02;
    return [
      [lng - padScale, lat - padScale],
      [lng + padScale, lat + padScale],
    ];
  }

  function doFocusMarker(markerId: string, focusOpts: FocusOpts): void {
    const m = markers.find((x) => x.id === markerId);
    if (!m || !currentFloor) return;
    const [lng, lat] = svgPointToLngLat(m.x, m.y);
    const category = getCategory(normalizeCategory(m.category));
    const zoomDelta =
      focusOpts.targetZoomDelta ?? Math.max(category.revealTier - 1, 1);
    const maxZoom = Math.min(fitZoom + zoomDelta, map.getMaxZoom());
    // The asymmetric bottom padding deliberately offsets the centre upward so
    // the pin clears the detail sheet. Guard against clampCameraCenter, which
    // measures from the symmetric viewport and would otherwise snap that
    // offset back on the fly's moveend.
    isApplyingCameraIntent = true;
    map.once("moveend", () => {
      isApplyingCameraIntent = false;
    });
    map.fitBounds(tinyBoundsAround(lng, lat), {
      maxZoom,
      padding: {
        top: 0,
        left: 0,
        right: 0,
        bottom: focusOpts.bottomPadding ?? 0,
      },
      animate: focusOpts.animate ?? true,
      duration: 550,
      essential: true,
    });
  }

  function doFocusSpot(spot: UserSpot, focusOpts: FocusOpts): void {
    if (!currentFloor || spot.floorId !== currentFloor.id) return;
    const [lng, lat] = svgPointToLngLat(spot.x, spot.y);
    const maxZoom = Math.min(
      fitZoom + (focusOpts.targetZoomDelta ?? 2),
      map.getMaxZoom(),
    );
    // See doFocusMarker: shield the padded focus offset from clampCameraCenter.
    isApplyingCameraIntent = true;
    map.once("moveend", () => {
      isApplyingCameraIntent = false;
    });
    map.fitBounds(tinyBoundsAround(lng, lat), {
      maxZoom,
      padding: {
        top: 0,
        left: 0,
        right: 0,
        bottom: focusOpts.bottomPadding ?? 0,
      },
      animate: focusOpts.animate ?? true,
      duration: 550,
      essential: true,
    });
  }

  function computeBottomHidden(): number {
    if (typeof window === "undefined") return 0;
    const rect = container.getBoundingClientRect();
    const visibleViewportBottom = window.innerHeight - bottomNavHeight;
    return Math.max(0, rect.bottom - visibleViewportBottom);
  }

  // Re-fit on container resize (orientation, sheets opening, late reflow).
  // Sticky focus is reapplied so preview tiles keep their pin centred.
  const ro = new ResizeObserver(() => {
    if (!currentFloor) return;
    if (container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
    if (applyFit() && stickyFocus) {
      const snap: FocusOpts = { ...stickyFocus.opts, animate: false };
      if (stickyFocus.kind === "marker")
        doFocusMarker(stickyFocus.markerId, snap);
      else doFocusSpot(stickyFocus.spot, snap);
    }
  });
  ro.observe(container);

  await new Promise<void>((resolve) => {
    if (map.loaded()) resolve();
    else map.once("load", () => resolve());
  });

  map.on("move", scheduleLabelSync);
  map.on("zoom", scheduleLabelSync);
  map.on("zoom", updatePanLock);
  map.on("zoom", updateLabelScale);
  // Clamping on 'moveend' (not every 'move' frame) lets the drag run free
  // and snaps the centre to the allowed range on release. Clamping on
  // 'move' fights the drag handler and produces stuttery near-bounds drag.
  map.on("moveend", clampCameraCenter);
  map.on("rotate", scheduleLabelSync);
  map.on("zoomend", updateZoomTier);

  // Defensive guard against MapLibre firing `click` after a small drag
  // (within the 3px clickTolerance). Without this, admin users dragging
  // to pan get a marker placed at the drop point.
  let didDragSinceMousedown = false;
  map.on("mousedown", () => {
    didDragSinceMousedown = false;
  });
  map.on("touchstart", () => {
    didDragSinceMousedown = false;
  });
  map.on("dragstart", () => {
    didDragSinceMousedown = true;
  });

  map.on("click", (e) => {
    if (transitioning) return;
    if (didDragSinceMousedown) return;
    if (!currentFloor) return;
    if (currentKind === "site") {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["main-building-hit"],
      });
      if (hits.length > 0) {
        opts.onBuildingClick?.();
        return;
      }
    }
    const { x, y } = lngLatToSvgPoint(e.lngLat.lng, e.lngLat.lat);
    if (x < 0 || y < 0 || x > projected._vbW || y > projected._vbH) {
      opts.onVoidClick?.();
      return;
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (opts.blockOutOfBounds && !isPinDropAllowed(x, y)) {
      opts.onBlockedClick?.({ x: rx, y: ry, floorId: currentFloor.id });
      return;
    }
    opts.onMapClick?.({ x: rx, y: ry, floorId: currentFloor.id });
  });

  // MapLibre fills don't expose CSS hover, so drive cursor via mousemove
  // to show a pointer when over the outdoor building.
  map.on("mousemove", (e) => {
    if (currentKind !== "site") {
      container.style.cursor = "";
      return;
    }
    const hits = map.queryRenderedFeatures(e.point, {
      layers: ["main-building-hit"],
    });
    container.style.cursor = hits.length > 0 ? "pointer" : "";
  });
  map.on("mouseleave", () => {
    container.style.cursor = "";
  });

  return {
    async setFloor(floor) {
      if (currentFloor?.id === floor.id) return;
      stickyFocus = null;
      currentFloor = floor;
      const kind: "site" | "floor" = isOutdoorFloor(floor.id)
        ? "site"
        : "floor";
      currentKind = kind;
      projected = getProjected(floor.id);
      mainBuildingBBox =
        kind === "site"
          ? unionBounds(
              mainBuildingFootprintFeatures().map((f) => featureBounds(f.geometry)),
            )
          : null;

      map.setStyle(makeStyle(projected, kind));
      // Wait for the new style to settle; the timeout is a failsafe in case
      // styledata doesn't fire (diff-aware setStyle finding no real change).
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        map.once("styledata", done);
        setTimeout(done, 250);
      });

      applyFit();

      updateZoomTier();
      rebuildLabels();
      renderMarkers();
      applyZoneHighlight();
      setOverlayVisible(kind === "site");
      opts.onReady?.();
    },

    setMarkers(next) {
      markers = next;
      renderMarkers();
      applyZoneHighlight();
      // Apply any sticky focusMarker that was requested before this list
      // arrived (typical race: consumer calls focusMarker on @ready, but
      // the wrapper's setMarkers runs AFTER setFloor resolves).
      const sf = stickyFocus;
      if (sf && sf.kind === "marker") {
        const m = markers.find((x) => x.id === sf.markerId);
        if (m) doFocusMarker(sf.markerId, { ...sf.opts, animate: false });
      }
    },

    setZones(next) {
      zones = next;
      applyZoneHighlight();
    },

    setSelectedMarker(id) {
      selectedMarkerId = id;
      applySelectedClass();
      applyZoneHighlight();
    },

    setUserSpot(spot) {
      renderUserSpot(spot);
    },

    setBottomNavHeight(px) {
      if (px === bottomNavHeight) return;
      bottomNavHeight = Math.max(0, px);
      if (currentFloor) applyFit();
    },

    focusMarker(markerId, focusOpts = {}) {
      doFocusMarker(markerId, focusOpts);
      stickyFocus = focusOpts.sticky
        ? { kind: "marker", markerId, opts: focusOpts }
        : null;
    },

    focusSpot(spot, focusOpts = {}) {
      doFocusSpot(spot, focusOpts);
      stickyFocus = focusOpts.sticky
        ? { kind: "spot", spot, opts: focusOpts }
        : null;
    },

    fitToFloor() {
      if (!currentFloor) return;
      // Explicit "show me the whole floor" intent. Drop any sticky focus so
      // the next resize doesn't yank back to the pin.
      stickyFocus = null;
      applyFit();
    },

    invalidateSize() {
      map.resize();
    },

    isPointInForbiddenZone(svgX, svgY) {
      if (!currentFloor) return false;
      return isPointInForbiddenZone(svgX, svgY);
    },

    getZoneAt(svgX, svgY) {
      if (!currentFloor) return null;
      const [lng, lat] = svgPointToLngLat(svgX, svgY);
      for (const feat of projected.features) {
        const tags = feat.properties.tags ?? [];
        if (!tags.includes("zone")) continue;
        // Prefer the converter-emitted slug; fall back to slugifying name
        // so older GeoJSONs (no `id` field) still resolve.
        const id = feat.properties.id ?? slugify(feat.properties.name);
        if (!id) continue;
        const geom = feat.geometry;
        if (geom.type === "Polygon") {
          if (pointInPolygon(lng, lat, geom.coordinates as number[][][]))
            return id;
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates as number[][][][]) {
            if (pointInPolygon(lng, lat, poly)) return id;
          }
        }
      }
      return null;
    },

    setTransitioning(value) {
      transitioning = value;
    },

    flyToBuildingBounds(flyOpts) {
      const feats = mainBuildingFootprintFeatures();
      if (feats.length === 0) return Promise.resolve(false);
      const bbox = unionBounds(feats.map((f) => featureBounds(f.geometry)));
      if (!bbox) return Promise.resolve(false);
      const duration = flyOpts?.duration ?? 0.5;
      const maxZoomDelta = flyOpts?.maxZoomDelta ?? 2.5;
      // Always zoom IN: `max(currentZoom + delta, fitZoom + maxZoomDelta)` so
      // the motion feels like "entering" even when the user was already
      // zoomed in past the default target.
      const ZOOM_IN_DELTA = 0.5;
      const defaultTarget = Math.min(fitZoom + maxZoomDelta, map.getMaxZoom());
      const targetZoom = Math.max(map.getZoom() + ZOOM_IN_DELTA, defaultTarget);
      const centerLng = (bbox[0][0] + bbox[1][0]) / 2;
      const centerLat = (bbox[0][1] + bbox[1][1]) / 2;
      return new Promise<boolean>((resolve) => {
        const onEnd = () => resolve(true);
        map.once("moveend", onEnd);
        map.easeTo({
          center: [centerLng, centerLat],
          zoom: targetZoom,
          duration: duration * 1000,
          essential: true,
        });
        // Failsafe. Some short flights skip moveend.
        setTimeout(onEnd, Math.ceil(duration * 1000) + 50);
      });
    },

    fadeFlash(direction, durationMs) {
      flashEl.style.transition = `opacity ${durationMs}ms ease`;
      void flashEl.offsetHeight;
      flashEl.style.opacity = direction === "in" ? "1" : "0";
      return new Promise<void>((resolve) =>
        setTimeout(() => resolve(), durationMs),
      );
    },

    enableZoomOutGesture({ belowFitBy = 0.7, onTrigger }) {
      const wasArmed = zoomOutGesture !== null;
      zoomOutGesture = { belowFitBy, onTrigger };
      if (currentFloor) map.setMinZoom(fitZoom - belowFitBy);
      if (!wasArmed) map.on("zoom", onZoomEventForGesture);
    },

    disableZoomOutGesture() {
      if (!zoomOutGesture) return;
      zoomOutGesture = null;
      map.off("zoom", onZoomEventForGesture);
      if (currentFloor) map.setMinZoom(fitZoom);
    },

    destroy() {
      ro.disconnect();
      if (labelRaf !== null) cancelAnimationFrame(labelRaf);
      for (const { el } of labelEntries) el.remove();
      labelEntries.length = 0;
      labelsEl.remove();
      for (const { el } of markerEntries.values()) el.remove();
      markerEntries.clear();
      markersRoot.remove();
      if (userPin) {
        userPin.el.remove();
        userPin = null;
      }
      overlayHostEl.remove();
      buildingTargetEl.remove();
      flashEl.remove();
      map.remove();
    },
  };
}
