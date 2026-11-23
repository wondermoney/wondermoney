import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { FuelType } from "@/lib/calculators/fuelCost";
import { stationPlace, type CheapStation, type GeoPoint } from "@/lib/calculators/fuelStations";
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

  useEffect(() => {
    if (!container.current) return;
    try {
      map.current = new MapLibreMap({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [-8.2, 39.6],
        zoom: 5.5,
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
      });
    } catch {
      // No WebGL, or the browser refused a context: the list's own links still work.
      setFailed(true);
    }
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [t, locale]);

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    const euro = (value: number) => formatMoney(locale, value, { decimals: 3 });
    const fuelName = t(`tools.fuelPrices.fuels.${fuel}`);
    const located = stations.filter((station) => station.lat !== null && station.lon !== null);
    const markers: Marker[] = [];
    const bounds = new LngLatBounds();

    located.forEach((station, index) => {
      const lngLat: [number, number] = [station.lon!, station.lat!];
      bounds.extend(lngLat);
      const marker = new Marker({ element: markerElement(station, index, euro, formatNumber(locale, station.price, 3), fuel), anchor: "bottom" })
        .setLngLat(lngLat)
        .setPopup(
          new Popup({ offset: POPUP_OFFSET, maxWidth: "14rem", closeButton: true, className: "z-[200]" }).setDOMContent(
            popupContent(station, `${euro(station.price)}/L`, fuelName, t(k("updated"), { date: station.updated }), t(k("directions"))),
          ),
        )
        .addTo(current);
      markers.push(marker);
    });
    if (origin) {
      const dot = document.createElement("div");
      dot.className = "size-4 rounded-full border-2 border-background bg-primary shadow";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", t(k("you")));
      markers.push(new Marker({ element: dot }).setLngLat([origin.lon, origin.lat]).addTo(current));
      bounds.extend([origin.lon, origin.lat]);
    }
    // More room on top: a pill stands above its point.
    if (!bounds.isEmpty()) current.fitBounds(bounds, { padding: { top: 56, bottom: 28, left: 40, right: 56 }, maxZoom: 14, duration: 0 });
    return () => markers.forEach((marker) => marker.remove());
  }, [stations, fuel, origin, t, locale]);

  if (failed) return <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("mapUnavailable"))}</p>;
  return (
    <div
      ref={container}
      role="region"
      aria-label={t(k("mapLabel"))}
      className="h-80 w-full overflow-hidden rounded-card border border-border sm:h-96"
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
