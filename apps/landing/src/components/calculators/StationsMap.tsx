import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapSourceDataEvent,
} from "maplibre-gl";
import mapCssUrl from "maplibre-gl/dist/maplibre-gl.css?url";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FuelType } from "@/lib/calculators/fuelCost";
import { stationPlace, type CheapStation, type GeoBounds, type GeoPoint } from "@/lib/calculators/fuelStations";
import {
  CLUSTER_PROPERTIES,
  MAINLAND_PORTUGAL_BOUNDS,
  clusterCheapest,
  clusterLabel,
  fitPadding,
  initialViewBounds,
  stationFeatures,
} from "@/lib/calculators/stationMap";
import { brandMonogram, findBrandLogo, logoSrc } from "@/lib/brandLogos";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";
import { fuelColor } from "./fuelColors";

/**
 * The map of the listed stations. This module is the only one that imports MapLibre, and the page
 * loads it with a dynamic import when the visitor opens the map, so neither the library nor the
 * tiles are fetched on first paint. Tiles: OpenFreeMap (no key), whose server sees the viewer's
 * IP address and the area on screen, as the guide and the privacy policy say. The visitor's own
 * position is drawn as a dot and sent nowhere.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// The bundler moves the worker beside the page's chunks; MapLibre would look for it beside its own.
setWorkerUrl(workerUrl);

/**
 * MapLibre's stylesheet, linked when the map first opens. A plain CSS import here would be
 * hoisted into the page's head by the build and block every visitor's first paint.
 */
let mapCss: Promise<void> | null = null;
function loadMapCss(): Promise<void> {
  mapCss ??= new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = mapCssUrl;
    // A failed stylesheet still lets the map draw; only its controls lose their look.
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
  return mapCss;
}

const k = (key: string) => `tools.fuelPrices.stations.${key}`;
/** Markers hang above their point (anchor bottom), so a popup below the point clears it and one above clears the pill. */
const POPUP_OFFSET = {
  center: [0, 0],
  top: [0, 6],
  "top-left": [0, 6],
  "top-right": [0, 6],
  bottom: [0, -30],
  "bottom-left": [0, -30],
  "bottom-right": [0, -30],
  left: [14, -14],
  right: [-14, -14],
} satisfies Record<string, [number, number]>;
const SOURCE_ID = "stations";
/** Pixels: about a price pill's width, so pills that would overlap join one cluster. */
const CLUSTER_RADIUS = 44;

const toLngLatBounds = ([south, west, north, east]: GeoBounds) => new LngLatBounds([west, south], [east, north]);

type Props = {
  stations: readonly CheapStation[];
  fuel: FuelType;
  /** The visitor's position in the near-me search, drawn as a dot; null otherwise. */
  origin: GeoPoint | null;
};

export default function StationsMap({ stations, fuel, origin }: Props) {
  const { t, locale } = useTranslations();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  /** The map once its style has loaded, when sources can be added to it. */
  const [loaded, setLoaded] = useState<MapLibreMap | null>(null);

  const [cssReady, setCssReady] = useState(false);
  useEffect(() => {
    let current = true;
    loadMapCss().then(() => current && setCssReady(true));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!cssReady || !container.current) return;
    try {
      map.current = new MapLibreMap({
        container: container.current,
        style: MAP_STYLE_URL,
        // Mainland Portugal until the stations' own view is fitted.
        bounds: toLngLatBounds(MAINLAND_PORTUGAL_BOUNDS),
        fitBoundsOptions: { padding: fitPadding(container.current.clientWidth, container.current.clientHeight) },
        // A one-finger drag scrolls the page on a phone; two fingers move the map.
        cooperativeGestures: true,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        locale: {
          "Map.Title": t(k("mapLabel")),
          "NavigationControl.ZoomIn": t(k("mapUi.zoomIn")),
          "NavigationControl.ZoomOut": t(k("mapUi.zoomOut")),
          "CooperativeGesturesHandler.WindowsHelpText": t(k("mapUi.gesturesWindows")),
          "CooperativeGesturesHandler.MacHelpText": t(k("mapUi.gesturesMac")),
          "CooperativeGesturesHandler.MobileHelpText": t(k("mapUi.gesturesMobile")),
          "AttributionControl.ToggleAttribution": t(k("mapUi.attribution")),
          "Popup.Close": t(k("mapUi.popupClose")),
        },
      });
      const created = map.current;
      created.addControl(new NavigationControl({ showCompass: false }), "top-right");
      created.touchZoomRotate.disableRotation();
      created.once("style.load", () => {
        // Place names in the page's language where OpenStreetMap has one, else the local name
        // (Lisboa, not the style's English "Lisbon"). Road numbers keep their own field.
        for (const layer of created.getStyle().layers) {
          const field = layer.type === "symbol" ? created.getLayoutProperty(layer.id, "text-field") : undefined;
          if (field && JSON.stringify(field).includes("name_en")) {
            created.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", `name:${locale}`], ["get", "name"]]);
          }
        }
      });
      created.once("load", () => {
        // The compact attribution starts open; on a phone it covers a third of the map. Folded
        // the way its own button folds it, it stays one tap away.
        const attribution = container.current?.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.setAttribute("open", "");
        setLoaded(created);
      });
    } catch {
      // No WebGL, or the browser refused a context: the list's own links still work.
      setFailed(true);
    }
    return () => {
      map.current?.remove();
      map.current = null;
      setLoaded(null);
    };
  }, [cssReady, t, locale]);

  // The view: the listed stations and the visitor, never wider than mainland Portugal.
  useEffect(() => {
    const current = map.current;
    if (!current) return;
    const points = stations.flatMap((station) => (station.lat !== null && station.lon !== null ? [{ lat: station.lat, lon: station.lon }] : []));
    if (origin) points.push(origin);
    const { clientWidth, clientHeight } = current.getContainer();
    current.fitBounds(toLngLatBounds(initialViewBounds(points)), { padding: fitPadding(clientWidth, clientHeight), maxZoom: 14, duration: 0 });
    if (!origin) return;
    const dot = document.createElement("div");
    dot.className = "size-4 rounded-full border-2 border-background bg-primary shadow";
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", t(k("you")));
    const marker = new Marker({ element: dot }).setLngLat([origin.lon, origin.lat]).addTo(current);
    return () => {
      marker.remove();
    };
  }, [cssReady, stations, origin, t]);

  // The stations, through a clustered GeoJSON source: a price pill per station, and where pills
  // would overlap one cluster showing the cheapest price among them, which zooms in when tapped.
  useEffect(() => {
    const current = loaded;
    if (!current) return;
    const euro = (value: number) => formatMoney(locale, value, { decimals: 3 });
    const fuelName = t(`tools.fuelPrices.fuels.${fuel}`);
    const located = stations.filter((station) => station.lat !== null && station.lon !== null);
    current.addSource(SOURCE_ID, {
      type: "geojson",
      data: stationFeatures(located),
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterProperties: CLUSTER_PROPERTIES,
    });
    // Invisible: the HTML markers are read from what it renders. The source's own query would also
    // return the clusters of the tiles kept from the zoom before, showing a cluster beside its pills.
    current.addLayer({ id: SOURCE_ID, type: "circle", source: SOURCE_ID, paint: { "circle-radius": 0, "circle-opacity": 0 } });
    const source = current.getSource<GeoJSONSource>(SOURCE_ID)!;

    const made = new Map<string, Marker>();
    let shown = new Map<string, Marker>();
    const markerFor = (key: string, create: () => Marker) => {
      let marker = made.get(key);
      if (!marker) {
        marker = create();
        made.set(key, marker);
      }
      return marker;
    };
    const update = () => {
      const next = new Map<string, Marker>();
      for (const feature of current.queryRenderedFeatures({ layers: [SOURCE_ID] })) {
        if (feature.geometry.type !== "Point") continue;
        const lngLat = feature.geometry.coordinates as [number, number];
        const properties = feature.properties ?? {};
        if (properties.cluster) {
          const clusterId = Number(properties.cluster_id);
          const cheapest = clusterCheapest(properties);
          if (cheapest === null) continue;
          const key = `cluster-${clusterId}`;
          if (next.has(key)) continue;
          next.set(
            key,
            markerFor(key, () => {
              const count = Number(properties.point_count);
              const element = clusterElement(clusterLabel(locale, cheapest), count, fuel, t(k("mapCluster"), { count, price: `${euro(cheapest)}/L` }));
              element.addEventListener("click", () => {
                source
                  .getClusterExpansionZoom(clusterId)
                  .then((zoom) => current.easeTo({ center: lngLat, zoom }))
                  .catch(() => current.easeTo({ center: lngLat, zoom: current.getZoom() + 2 }));
              });
              return new Marker({ element, anchor: "center" }).setLngLat(lngLat);
            }),
          );
          continue;
        }
        const rank = Number(properties.rank);
        const station = located[rank];
        const key = `station-${rank}`;
        if (!station || next.has(key)) continue;
        next.set(
          key,
          markerFor(key, () =>
            new Marker({ element: markerElement(station, rank, euro, formatNumber(locale, station.price, 3), fuel), anchor: "bottom" })
              .setLngLat(lngLat)
              .setPopup(
                new Popup({ offset: POPUP_OFFSET, maxWidth: "14rem", closeButton: true, className: "z-[200]" }).setDOMContent(
                  popupContent(station, `${euro(station.price)}/L`, fuelName, t(k("updated"), { date: station.updated }), t(k("directions"))),
                ),
              ),
          ),
        );
      }
      for (const [key, marker] of shown) if (!next.has(key)) marker.remove();
      for (const [key, marker] of next) if (!shown.has(key)) marker.addTo(current);
      shown = next;
    };
    const onData = (event: MapSourceDataEvent) => {
      if (event.sourceId === SOURCE_ID && event.isSourceLoaded) update();
    };
    current.on("sourcedata", onData);
    current.on("move", update);
    // Once the new zoom's tiles have replaced the ones kept from the zoom before.
    current.on("idle", update);
    update();

    return () => {
      current.off("sourcedata", onData);
      current.off("move", update);
      current.off("idle", update);
      shown.forEach((marker) => marker.remove());
      // The map is gone already when it is being rebuilt or the page leaves it.
      if (map.current !== current) return;
      if (current.getLayer(SOURCE_ID)) current.removeLayer(SOURCE_ID);
      if (current.getSource(SOURCE_ID)) current.removeSource(SOURCE_ID);
    };
  }, [loaded, stations, fuel, t, locale]);

  if (failed) return <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("mapUnavailable"))}</p>;
  return (
    <div
      ref={container}
      role="region"
      aria-label={t(k("mapLabel"))}
      className="h-80 w-full overflow-hidden rounded-card border border-border sm:h-96 lg:h-[32rem]"
    />
  );
}

/** A price pill in the fuel's colour, the cheapest one larger and on top. A button, so it opens its popup by keyboard too. */
function markerElement(station: CheapStation, index: number, euro: (value: number) => string, figure: string, fuel: FuelType): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `rounded-full border-2 border-background px-2 py-0.5 font-mono font-semibold text-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    index === 0 ? "text-sm" : "text-xs"
  }`;
  element.style.backgroundColor = fuelColor(fuel);
  // The figure alone keeps neighbouring pills from overlapping; the label and the popup carry €/L.
  element.textContent = figure;
  // The cheapest on top where pills overlap; an open popup (z-[200]) above them all.
  element.style.zIndex = String(100 - index);
  element.setAttribute("aria-label", `${index + 1}. ${station.label}, ${euro(station.price)}/L`);
  return element;
}

/**
 * A cluster: its cheapest price on the page's surface, ringed in the fuel's colour, with the number
 * of stations in a dot of that colour, so it reads apart from a station's filled pill. A button
 * that zooms in, by keyboard too.
 */
function clusterElement(figure: string, count: number, fuel: FuelType, label: string): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className =
    "flex items-center gap-1 rounded-full border-2 bg-background py-0.5 pl-2 pr-0.5 font-mono text-xs font-semibold text-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  element.style.borderColor = fuelColor(fuel);
  // Above the station pills; an open popup (z-[200]) above it.
  element.style.zIndex = "101";
  element.setAttribute("aria-label", label);
  const price = document.createElement("span");
  price.textContent = figure;
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.className = "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-sans text-[10px] leading-none text-white";
  dot.style.backgroundColor = fuelColor(fuel);
  dot.textContent = String(count);
  element.append(price, dot);
  return element;
}

/** Built from DOM nodes and text, never HTML: the brand and locality come from DGEG. */
function popupContent(station: CheapStation, price: string, fuelName: string, updated: string, directions: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "space-y-1 font-sans text-sm text-foreground";
  const add = (tag: string, className: string, text: string) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    root.append(node);
    return node;
  };
  const title = add("p", "flex items-start gap-2 font-medium", "");
  title.append(brandTile(station.brand), station.label);
  const place = stationPlace(station);
  if (place) add("p", "text-muted-foreground", place);
  add("p", "font-mono text-base font-semibold", price);
  add("p", "text-xs text-muted-foreground", fuelName);
  add("p", "text-xs text-muted-foreground", updated);
  const link = add("a", "inline-block pt-1 font-medium text-primary underline decoration-primary/40 underline-offset-4", directions) as HTMLAnchorElement;
  link.href = station.mapUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return root;
}

/** The same tile as BrandLogo.tsx, for a popup built outside React: the logo on white, or the initials. */
function brandTile(brand: string): HTMLElement {
  const tile = document.createElement("span");
  tile.setAttribute("aria-hidden", "true");
  tile.className = "inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border";
  const entry = findBrandLogo(brand);
  if (!entry) {
    tile.classList.add("bg-paper-2", "text-[10px]", "font-semibold", "leading-none", "text-ink-2");
    tile.textContent = brandMonogram(brand);
    return tile;
  }
  tile.classList.add("bg-white");
  const image = document.createElement("img");
  image.src = logoSrc(entry.logo);
  image.alt = "";
  image.width = 24;
  image.height = 24;
  image.className = "size-full object-cover";
  tile.append(image);
  return tile;
}
