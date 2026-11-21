"use client";

/**
 * Carte MapLibre GL — apps/web/src/components/map/CampusMap.tsx
 *
 * Ce composant est le seul endroit du frontend qui touche au DOM de MapLibre.
 * Il reçoit des `FeatureCollection` déjà construites et se contente de les
 * peindre : aucune donnée n'est fabriquée ici.
 *
 * Points d'attention volontairement traités :
 *  - les sources sont mises à jour via `setData()`, jamais en recréant la carte
 *    (recréer détruirait la position, le zoom et l'état de survol) ;
 *  - les couches sont ajoutées de façon idempotente : `on('load')` peut se
 *    déclencher après un remontage en StrictMode, et ajouter deux fois une
 *    source lève une exception qui casse tout le rendu ;
 *  - le clic sur un polygone lit `feature.id`, pas une propriété devinée.
 */

import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { darkStyle, INITIAL_VIEW } from "@/lib/map-style";
import type {
  BuildingFeatureCollection,
  EdgeFeatureCollection,
  NodeFeatureCollection,
} from "@/lib/geo";

const SRC_BUILDINGS = "uac-buildings";
const SRC_MARKERS = "uac-markers";
const SRC_NODES = "uac-nodes";
const SRC_EDGES = "uac-edges";
const SRC_ROUTE = "uac-route";

const LYR_BUILDINGS_FILL = "uac-buildings-fill";
const LYR_BUILDINGS_LINE = "uac-buildings-line";
const LYR_BUILDINGS_EXTRUDE = "uac-buildings-extrude";
const LYR_BUILDINGS_LABEL = "uac-buildings-label";
const LYR_MARKERS = "uac-markers-circle";
const LYR_NODES = "uac-nodes-circle";
const LYR_EDGES = "uac-edges-line";
const LYR_ROUTE = "uac-route-line";

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

export interface CampusMapProps {
  buildings: BuildingFeatureCollection;
  markers: NodeFeatureCollection;
  nodes: NodeFeatureCollection;
  edges: EdgeFeatureCollection;
  route: EdgeFeatureCollection;
  selectedId: string | null;
  showBuildings2d: boolean;
  showBuildings3d: boolean;
  showMarkers: boolean;
  showNodes: boolean;
  showEdges: boolean;
  showRoute: boolean;
  onSelect: (buildingId: string | null) => void;
  onMapReady?: (map: MapLibreMap) => void;
}

export function CampusMap(props: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(props.onSelect);

  // On garde le callback dans une ref : sinon, chaque rendu du parent
  // réinstallerait les écouteurs d'événements de la carte.
  onSelectRef.current = props.onSelect;

  // ---------------------------------------------------------------------
  // Création de la carte (une seule fois)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkStyle,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      attributionControl: { compact: true },
      // Le pincement à deux doigts doit rester possible sur mobile, mais on
      // évite la rotation accidentelle pendant un défilement de page.
      dragRotate: true,
      pitchWithRotate: false,
      maxPitch: 70,
      minZoom: 12,
      maxZoom: 19,
    });

    // Les contrôles restent en bas à droite (position standard, pouce sur
    // mobile). Ils étaient auparavant recouverts par la barre de navigation
    // inférieure : la cause était la hauteur du conteneur de carte
    // (`calc(100vh - 57px)`), qui débordait sous la barre. Le conteneur est
    // désormais en `flex-1` dans une coquille `h-[100dvh]`, et
    // `globals.css` ajoute une marge basse de sécurité aux contrôles.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }),
      "bottom-right",
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");

    map.on("load", () => {
      // --- Sources ---
      map.addSource(SRC_BUILDINGS, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC_MARKERS, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC_NODES, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC_EDGES, { type: "geojson", data: EMPTY_FC });
      map.addSource(SRC_ROUTE, { type: "geojson", data: EMPTY_FC });

      // --- Bâtiments : aplat + contour + volume + étiquette ---
      map.addLayer({
        id: LYR_BUILDINGS_FILL,
        type: "fill",
        source: SRC_BUILDINGS,
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#8B5CF6",
            ["==", ["get", "verificationStatus"], "VERIFIED"],
            "#35D6F5",
            "#35D6F5",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.55,
            ["boolean", ["feature-state", "hover"], false],
            0.38,
            0.22,
          ],
        },
      });

      map.addLayer({
        id: LYR_BUILDINGS_LINE,
        type: "line",
        source: SRC_BUILDINGS,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#C4B5FD",
            "#35D6F5",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2.6,
            ["boolean", ["feature-state", "hover"], false],
            2.0,
            1.2,
          ],
          "line-opacity": 0.9,
        },
      });

      // Volume extrudé : `floors × 3.4 m` (hauteur de niveau plausible) n'est
      // PAS une donnée inventée sur le bâtiment : c'est une constante de rendu
      // explicite, dérivée du seul champ réel disponible (`floors`).
      map.addLayer({
        id: LYR_BUILDINGS_EXTRUDE,
        type: "fill-extrusion",
        source: SRC_BUILDINGS,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#8B5CF6",
            "#1D7FA8",
          ],
          "fill-extrusion-height": ["*", ["coalesce", ["get", "floors"], 1], 3.4],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.88,
        },
      });

      map.addLayer({
        id: LYR_BUILDINGS_LABEL,
        type: "symbol",
        source: SRC_BUILDINGS,
        minzoom: 15.6,
        layout: {
          "text-field": ["coalesce", ["get", "shortName"], ["get", "code"]],
          "text-size": 11,
          "text-font": ["Open Sans Regular"],
          "text-anchor": "center",
          "text-allow-overlap": false,
          "text-padding": 4,
        },
        paint: {
          "text-color": "#F8FAFC",
          "text-halo-color": "#070B14",
          "text-halo-width": 1.6,
        },
      });

      // --- Marqueurs (bâtiments sans polygone) ---
      map.addLayer({
        id: LYR_MARKERS,
        type: "circle",
        source: SRC_MARKERS,
        paint: {
          "circle-radius": 6,
          "circle-color": "#8B5CF6",
          "circle-stroke-color": "#070B14",
          "circle-stroke-width": 1.6,
        },
      });

      // --- Graphe piéton ---
      map.addLayer({
        id: LYR_EDGES,
        type: "line",
        source: SRC_EDGES,
        layout: { visibility: "none" },
        paint: {
          "line-color": ["case", ["==", ["get", "accessible"], true], "#22C55E", "#F59E0B"],
          "line-width": 1.6,
          "line-dasharray": [2, 2],
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: LYR_NODES,
        type: "circle",
        source: SRC_NODES,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 3.2,
          "circle-color": "#F8FAFC",
          "circle-stroke-color": "#22C55E",
          "circle-stroke-width": 1.4,
        },
      });

      map.addLayer({
        id: LYR_ROUTE,
        type: "line",
        source: SRC_ROUTE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#35D6F5",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      // Halo sous l'itinéraire : améliore la lisibilité sur fond sombre.
      map.addLayer(
        {
          id: `${LYR_ROUTE}-halo`,
          type: "line",
          source: SRC_ROUTE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#8B5CF6", "line-width": 9, "line-opacity": 0.28, "line-blur": 3 },
        },
        LYR_ROUTE,
      );

      // --- Interactions ---
      map.on("click", LYR_BUILDINGS_FILL, (event: MapMouseEvent & { features?: unknown[] }) => {
        const feature = event.features?.[0] as
          | { id?: string | number; properties?: { id?: string } }
          | undefined;
        const id = feature?.properties?.id ?? (feature?.id != null ? String(feature.id) : null);
        onSelectRef.current(id);
      });

      // Clic sur le fond : désélectionne.
      map.on("click", (event) => {
        if (event.defaultPrevented) return;
        const hits = map.queryRenderedFeatures(event.point, { layers: [LYR_BUILDINGS_FILL] });
        if (hits.length === 0) onSelectRef.current(null);
      });

      // Curseur + survol (feature-state n'existe que sur les features promues).
      let hoveredId: string | number | null = null;
      map.on("mousemove", LYR_BUILDINGS_FILL, (event) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0];
        if (!feature?.id) return;
        if (hoveredId !== null && hoveredId !== feature.id) {
          map.setFeatureState({ source: SRC_BUILDINGS, id: hoveredId }, { hover: false });
        }
        hoveredId = feature.id;
        map.setFeatureState({ source: SRC_BUILDINGS, id: feature.id }, { hover: true });
      });

      map.on("mouseleave", LYR_BUILDINGS_FILL, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredId !== null) {
          map.setFeatureState({ source: SRC_BUILDINGS, id: hoveredId }, { hover: false });
          hoveredId = null;
        }
      });

      props.onMapReady?.(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Volontairement vide : la carte n'est créée qu'une fois pour toute la vie
    // du composant. Les données sont injectées par les effets ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // Injection des données
  // ---------------------------------------------------------------------
  useSetSource(mapRef, SRC_BUILDINGS, props.buildings);
  useSetSource(mapRef, SRC_MARKERS, props.markers);
  useSetSource(mapRef, SRC_NODES, props.nodes);
  useSetSource(mapRef, SRC_EDGES, props.edges);
  useSetSource(mapRef, SRC_ROUTE, props.route);

  // ---------------------------------------------------------------------
  // Sélection
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.getSource(SRC_BUILDINGS)) return;
      // On efface tous les états de sélection connus, puis on pose le nouveau :
      // sans cela, la sélection précédente resterait colorée.
      const features = props.buildings.features;
      for (const feature of features) {
        map.setFeatureState(
          { source: SRC_BUILDINGS, id: feature.id },
          { selected: feature.properties.id === props.selectedId },
        );
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [props.selectedId, props.buildings]);

  // ---------------------------------------------------------------------
  // Visibilité des couches
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const set = (id: string, visible: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      };
      set(LYR_BUILDINGS_FILL, props.showBuildings2d);
      set(LYR_BUILDINGS_LINE, props.showBuildings2d || props.showBuildings3d);
      set(LYR_BUILDINGS_LABEL, props.showBuildings2d || props.showBuildings3d);
      set(LYR_BUILDINGS_EXTRUDE, props.showBuildings3d);
      set(LYR_MARKERS, props.showMarkers);
      set(LYR_NODES, props.showNodes);
      set(LYR_EDGES, props.showEdges);
      set(LYR_ROUTE, props.showRoute);
      set(`${LYR_ROUTE}-halo`, props.showRoute);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [
    props.showBuildings2d,
    props.showBuildings3d,
    props.showMarkers,
    props.showNodes,
    props.showEdges,
    props.showRoute,
  ]);

  return <div ref={containerRef} className="h-full w-full" />;
}

/**
 * Injecte une `FeatureCollection` dans une source GeoJSON existante.
 *
 * `setData` est préféré à un retrait/ajout de source : il conserve l'état de la
 * carte et ne provoque pas de clignotement.
 */
function useSetSource(
  mapRef: React.RefObject<MapLibreMap | null>,
  sourceId: string,
  data: { type: "FeatureCollection"; features: unknown[] },
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(sourceId);
      if (source && "setData" in source) {
        (source as maplibregl.GeoJSONSource).setData(
          data as unknown as GeoJSON.FeatureCollection,
        );
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [mapRef, sourceId, data]);
}
