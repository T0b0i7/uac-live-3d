"use client";

/**
 * Page carte — apps/web/src/app/map/page.tsx
 *
 * Assemble : données réelles → GeoJSON → MapLibre → sélection → fiche.
 *
 * Le graphe piéton est chargé à la demande (bouton « Afficher le réseau ») car
 * il pèse plus lourd que les bâtiments : l'utilisateur qui vient voir la carte
 * n'a pas besoin des 21 allées au premier rendu.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  Building2,
  Compass,
  Layers,
  LocateFixed,
  Search,
  Route as RouteIcon,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CampusMap } from "@/components/map/CampusMap";
import { BuildingDetail, type BuildingSummary } from "@/components/map/BuildingDetail";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import { useMapBuildings } from "@/lib/hooks";
import { usePedestrianGraphOffline } from "@/lib/offline/useGraph";
import { computeRouteBetweenNodes, computeLocalRoute } from "@/lib/offline/graph-cache";
import { computeReachability } from "@/lib/offline/reachability";
import { haversineMeters } from "@uac/geospatial";
import {
  buildingLabel,
  buildingsToFeatureCollection,
  buildingsWithoutGeometry,
  graphEdgesToFeatureCollection,
  graphNodesToFeatureCollection,
  routeToFeatureCollection,
  type NodeFeatureCollection,
} from "@/lib/geo";
import { useAppStore } from "@/lib/store";
import { VIEW_2D, VIEW_3D } from "@/lib/map-style";

const EMPTY_FC: NodeFeatureCollection = { type: "FeatureCollection", features: [] };

export default function MapPage() {
  /**
   * Endpoint non paginé : la carte doit dessiner TOUTES les emprises.
   *
   * L'ancien appel `useBuildings({ limit: 100 })` demandait 100 emprises pour
   * 360 bâtiments. Rien ne le signalait à l'écran : la carte paraissait
   * complète alors que 255 emprises n'étaient jamais dessinées.
   */
  const buildingsQuery = useMapBuildings();
  const graphState = usePedestrianGraphOffline();

  const {
    selectedBuildingId,
    selectBuilding,
    layers,
    toggleLayer,
    setLayer,
    mapMode,
    setMapMode,
    routeNodeIds,
    setRoute,
    clearRoute,
  } = useAppStore();

  const mapRef = useRef<MapLibreMap | null>(null);
  const [search, setSearch] = useState("");
  const [layersOpen, setLayersOpen] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{
    meters: number;
    minutes: number;
    /**
     * Qualité du tracé. `partial_direct` signifie qu'aucun cheminement
     * cartographié ne relie les deux points : la distance affichée est à vol
     * d'oiseau, pas un trajet piéton. L'interface doit le dire, sinon elle
     * présente une ligne droite comme un itinéraire.
     */
    quality: "on_network" | "partial_direct";
  } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const buildings = useMemo(() => buildingsQuery.data?.items ?? [], [buildingsQuery.data]);

  const buildingFeatures = useMemo(() => buildingsToFeatureCollection(buildings), [buildings]);

  const markerFeatures = useMemo<NodeFeatureCollection>(() => {
    const orphans = buildingsWithoutGeometry(buildings);
    return {
      type: "FeatureCollection",
      features: orphans.map((b) => ({
        type: "Feature" as const,
        id: b.id,
        geometry: {
          type: "Point" as const,
          coordinates: [b.centroid!.lng, b.centroid!.lat] as [number, number],
        },
        properties: {
          id: b.id,
          type: b.category,
          label: b.name,
          accessible: true,
        },
      })),
    };
  }, [buildings]);

  const nodeFeatures = useMemo(
    () =>
      graphState.payload ? graphNodesToFeatureCollection(graphState.payload.nodes) : EMPTY_FC,
    [graphState.payload],
  );

  const edgeFeatures = useMemo(
    () =>
      graphState.payload
        ? graphEdgesToFeatureCollection(graphState.payload.edges, graphState.payload.nodes)
        : { type: "FeatureCollection" as const, features: [] },
    [graphState.payload],
  );

  const routeFeatures = useMemo(() => {
    if (!graphState.graph || routeNodeIds.length < 2) {
      return { type: "FeatureCollection" as const, features: [] };
    }
    const coords: Array<{ lat: number; lng: number }> = [];
    for (const id of routeNodeIds) {
      const node = graphState.graph.nodes.get(id);
      if (node) coords.push({ lat: node.lat, lng: node.lng });
    }
    return routeToFeatureCollection(coords);
  }, [graphState.graph, routeNodeIds]);

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [buildings, selectedBuildingId],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return buildings;
    return buildings.filter((b) =>
      [b.name, b.code].some((value) =>
        value ? value.toLowerCase().includes(term) : false,
      ),
    );
  }, [buildings, search]);

  const handleSelect = useCallback(
    (id: string | null) => {
      selectBuilding(id);
      const map = mapRef.current;
      const building = id ? buildings.find((b) => b.id === id) : undefined;
      if (map && building?.centroid) {
        map.easeTo({
          center: [building.centroid.lng, building.centroid.lat],
          zoom: Math.max(map.getZoom(), 16.4),
          duration: 700,
        });
      }
    },
    [buildings, selectBuilding],
  );

  const handleMapReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map;
  }, []);

  const toggle3d = useCallback(() => {
    const next = mapMode === "2d" ? "3d" : "2d";
    setMapMode(next);
    const map = mapRef.current;
    if (!map) return;
    map.easeTo(next === "3d" ? { ...VIEW_3D, duration: 900 } : { ...VIEW_2D, duration: 900 });
  }, [mapMode, setMapMode]);

  const locateMe = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) {
      setRouteError("La géolocalisation n'est pas disponible dans ce navigateur.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 17,
          duration: 1200,
        });
      },
      () => setRouteError("Position refusée ou indisponible."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  /** Itinéraire depuis l'entrée du campus (IFRI) jusqu'au bâtiment choisi. */
  const routeToBuilding = useCallback(
    (building: BuildingSummary) => {
      setRouteError(null);
      setRouteInfo(null);
      const graph = graphState.graph;
      if (!graph) {
        setRouteError(
          "Le réseau piéton n'est pas chargé. Cliquez sur « Charger le réseau » puis réessayez.",
        );
        return;
      }

      const startNode = graph.nodes.get("IFRI");
      if (!startNode) {
        setRouteError("Le point de départ (entrée IFRI) est absent du graphe téléchargé.");
        return;
      }

      /**
       * Un nœud portant le code du bâtiment EXISTE presque toujours : ce sont
       * les 354 nœuds `ENTRANCE`. Mais la quasi-totalité d'entre eux a un degré
       * de 0 — aucun cheminement OSM ne les relie. Se contenter de tester
       * `graph.nodes.has(building.code)` puis lancer le calcul produisait donc
       * un échec sec (« aucun itinéraire n'existe ») au lieu d'expliquer
       * pourquoi. On vérifie d'abord l'appartenance à la MÊME composante
       * connexe que le départ : c'est la seule condition qui garantit qu'un
       * chemin existe réellement.
       */
      const reach = reachability ?? computeReachability(graph);
      const startComponent = reach.componentOf.get("IFRI");
      const targetNodeId =
        building.code && graph.nodes.has(building.code) ? building.code : null;
      const targetComponent = targetNodeId ? reach.componentOf.get(targetNodeId) : undefined;
      const genuinelyReachable =
        startComponent !== undefined &&
        targetComponent !== undefined &&
        startComponent === targetComponent;

      if (genuinelyReachable && targetNodeId) {
        const result = computeRouteBetweenNodes(graph, "IFRI", targetNodeId, {
          algorithm: "astar",
        });
        if (!result.found) {
          setRouteError("Le calcul a échoué malgré une composante commune — signaler ce cas.");
          clearRoute();
          return;
        }
        setRoute(result.nodeIds);
        setRouteInfo({
          meters: Math.round(result.distanceMeters),
          minutes: Math.round(result.estimatedMinutes),
          quality: "on_network",
        });
        setLayer("route", true);
        return;
      }

      /**
       * Aucun cheminement continu n'est cartographié jusqu'à ce bâtiment. On ne
       * trace PAS de détour inventé le long de voies supposées : on affiche un
       * segment direct depuis le départ, et on dit explicitement que ce n'est
       * pas un itinéraire piéton relevé. C'est la même convention que le repli
       * `partial_direct` du serveur.
       */
      const destination = building.centroid;
      if (!destination) {
        setRouteError(
          "Ce bâtiment n'a ni cheminement rattaché ni coordonnée exploitable : " +
            "aucun trajet ne peut être proposé, même indicatif.",
        );
        clearRoute();
        return;
      }

      const straight = haversineMeters(
        { lat: startNode.lat, lng: startNode.lng },
        { lat: destination.lat, lng: destination.lng },
      );
      setRoute([]);
      setRouteInfo({
        meters: Math.round(straight),
        minutes: Math.max(1, Math.round(straight / 78)),
        quality: "partial_direct",
      });
      clearRoute();
      setLayer("route", false);
    },
    [graphState.graph, setRoute, setLayer, clearRoute],
  );

  /**
   * Connectivité du réseau, calculée une seule fois par graphe chargé.
   *
   * Sans `useMemo`, `computeReachability` serait relancé à chaque rendu — donc à
   * chaque frappe dans le champ de recherche — et parcourrait 536 nœuds chaque
   * fois. Le résultat ne dépend que du graphe.
   */
  const reachability = useMemo(
    () => (graphState.graph ? computeReachability(graphState.graph) : null),
    [graphState.graph],
  );

  const showNetwork = useCallback(() => {
    setLayer("graphEdges", true);
    setLayer("graphNodes", true);
    if (!graphState.payload) void graphState.download();
  }, [graphState, setLayer]);

  return (
    <AppShell
      title="Carte du campus"
      subtitle={
        buildingsQuery.data
          ? `${buildingFeatures.features.length} emprises dessinées sur ${buildingsQuery.data.total} bâtiments`
          : "Chargement des données…"
      }
      fullBleed
      actions={
        <>
          <button
            type="button"
            onClick={toggle3d}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              mapMode === "3d"
                ? "border-violet/60 bg-violet/15 text-violet"
                : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {mapMode === "3d" ? "3D" : "2D"}
          </button>
          <button
            type="button"
            onClick={() => setLayersOpen((v) => !v)}
            className="rounded-lg border border-line bg-surface p-1.5 text-muted transition hover:text-ink"
            aria-label="Gérer les couches"
          >
            <Layers size={15} />
          </button>
          <button
            type="button"
            onClick={locateMe}
            className="rounded-lg border border-line bg-surface p-1.5 text-muted transition hover:text-ink"
            aria-label="Me localiser"
          >
            <LocateFixed size={15} />
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        {/* ---------- Colonne gauche : recherche + liste ---------- */}
        <div className="hidden w-72 shrink-0 flex-col border-r border-line lg:flex">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un bâtiment…"
                className="w-full rounded-lg border border-line bg-secondary py-2 pl-8 pr-2.5 text-xs text-ink placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={showNetwork}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface py-1.5 text-[11px] text-muted transition hover:border-primary/50 hover:text-primary"
            >
              <RouteIcon size={12} />
              {graphState.payload ? "Réseau piéton chargé" : "Charger le réseau piéton"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {buildingsQuery.isLoading ? (
              <div className="space-y-2 p-1">
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
                <SkeletonBlock className="h-12 w-full" />
              </div>
            ) : buildingsQuery.isError ? (
              <ErrorState
                error={buildingsQuery.error}
                onRetry={() => void buildingsQuery.refetch()}
                compact
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="Aucun bâtiment"
                description={
                  search
                    ? "Aucun bâtiment ne correspond à cette recherche."
                    : "La base ne contient aucun bâtiment."
                }
                icon={<Building2 size={22} />}
              />
            ) : (
              <ul className="space-y-1">
                {filtered.map((building) => {
                  const active = building.id === selectedBuildingId;
                  return (
                    <li key={building.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(building.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          active
                            ? "border-primary/60 bg-primary/12"
                            : "border-transparent hover:border-line hover:bg-surface"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-ink">
                              {buildingLabel(building)}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted">
                              {building.code}
                            </span>
                          </span>
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              building.geometry ? "bg-primary" : "bg-warn"
                            }`}
                            title={
                              building.geometry
                                ? "Emprise géographique disponible"
                                : "Sans emprise : marqueur seulement"
                            }
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ---------- Carte ---------- */}
        <div className="relative min-w-0 flex-1">
          <CampusMap
            buildings={buildingFeatures}
            markers={markerFeatures}
            nodes={nodeFeatures}
            edges={edgeFeatures}
            route={routeFeatures}
            selectedId={selectedBuildingId}
            showBuildings2d={layers.buildings2d}
            showBuildings3d={layers.buildings3d}
            showMarkers={layers.markers}
            showNodes={layers.graphNodes}
            showEdges={layers.graphEdges}
            showRoute={layers.route}
            onSelect={handleSelect}
            onMapReady={handleMapReady}
          />

          {/* Bandeau recherche (mobile) */}
          <div className="absolute left-2 right-2 top-2 flex items-center gap-1.5 lg:hidden">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un bâtiment…"
                className="w-full rounded-xl border border-line bg-surface/95 py-2.5 pl-9 pr-3 text-xs text-ink shadow-xl backdrop-blur placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
              />
            </div>
            {/* Sur mobile, la colonne de gauche (qui porte le bouton réseau) est
                masquée : sans ce bouton, le graphe piéton était inaccessible. */}
            <button
              type="button"
              onClick={showNetwork}
              aria-label="Charger le réseau piéton"
              title={graphState.payload ? "Réseau piéton chargé" : "Charger le réseau piéton"}
              className={`shrink-0 rounded-xl border p-2.5 shadow-xl backdrop-blur transition ${
                graphState.payload
                  ? "border-ok/50 bg-ok/15 text-ok"
                  : "border-line bg-surface/95 text-muted"
              }`}
            >
              <RouteIcon size={15} />
            </button>
          </div>

          {/* Résultats de recherche (mobile) — DÉFAUT CORRIGÉ : la colonne de
              gauche qui affiche les résultats est en `lg:flex` (masquée sous
              1024 px). Le champ de recherche mobile filtrait donc une liste
              invisible : taper un nom ne produisait rien de visible. On rend
              ici les résultats filtrés, avec accès direct à la fiche. */}
          {search.trim().length > 0 ? (
            <div className="absolute left-2 right-2 top-[52px] z-10 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface/97 shadow-2xl backdrop-blur lg:hidden">
              {filtered.length === 0 ? (
                <p className="px-3 py-2.5 text-[11px] text-muted">
                  Aucun bâtiment ne correspond à « {search.trim()} ».
                </p>
              ) : (
                <ul>
                  {filtered.map((building) => (
                    <li key={building.id} className="border-b border-line/50 last:border-0">
                      <button
                        type="button"
                        onClick={() => {
                          handleSelect(building.id);
                          setSearch("");
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-primary/10"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink">
                            {buildingLabel(building)}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted">
                            {building.code}
                          </span>
                        </span>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            building.geometry ? "bg-primary" : "bg-warn"
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Légende / état du graphe — remonte au-dessus des contrôles de carte
              pour ne pas masquer l'échelle ni l'attribution OSM. */}
          {graphState.source ? (
            <div className="pointer-events-none absolute bottom-16 left-2 rounded-lg border border-line bg-surface/90 px-2 py-1 text-[10px] text-muted backdrop-blur md:bottom-3 md:left-3 md:px-2.5 md:py-1.5">
              Réseau piéton · {graphState.source === "network" ? "téléchargé" : "cache"} ·{" "}
              {graphState.payload?.nodes.length ?? 0} nœuds
              {/* Sans ce chiffre, l'interface laisse croire que le réseau couvre
                  tout le campus alors que la grande majorité des bâtiments n'y
                  sont pas raccordés. */}
              {graphState.graph ? (
                <>
                  {" · "}
                  {graphState.graph.edges.length} allées ·{" "}
                  {reachability?.componentCount ?? 0} zones distinctes
                </>
              ) : null}
            </div>
          ) : null}

          {/* Erreur d'itinéraire / géoloc */}
          {routeError ? (
            <div className="absolute bottom-16 left-3 right-3 flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/12 px-3 py-2 text-[11px] text-warn backdrop-blur md:left-1/2 md:right-auto md:w-96 md:-translate-x-1/2">
              <span className="flex-1">{routeError}</span>
              <button type="button" onClick={() => setRouteError(null)} aria-label="Fermer">
                <X size={12} />
              </button>
            </div>
          ) : null}

          {/* Résultat d'itinéraire.
              Deux cas nettement distingués : un tracé réellement issu du
              réseau (`on_network`), ou une simple distance à vol d'oiseau
              faute de cheminement cartographié (`partial_direct`). Les
              présenter de la même façon reviendrait à faire passer une ligne
              droite pour un itinéraire piéton. */}
          {routeInfo ? (
            <div
              className={`absolute bottom-16 left-3 right-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] backdrop-blur md:left-1/2 md:right-auto md:w-96 md:-translate-x-1/2 ${
                routeInfo.quality === "on_network"
                  ? "border-primary/40 bg-primary/12 text-primary"
                  : "border-warn/45 bg-warn/12 text-warn"
              }`}
            >
              <Compass size={13} className="mt-0.5 shrink-0" />
              <span className="flex-1">
                {routeInfo.quality === "on_network" ? (
                  <span className="font-medium">
                    {routeInfo.meters} m · ~{routeInfo.minutes} min à pied
                  </span>
                ) : (
                  <>
                    <span className="font-medium">
                      {routeInfo.meters} m à vol d'oiseau · ~{routeInfo.minutes} min
                    </span>
                    <span className="mt-0.5 block leading-relaxed">
                      Aucun cheminement piéton cartographié ne mène à ce bâtiment. Cette
                      distance est une ligne directe, <strong>pas un itinéraire</strong> :
                      le trajet réel est probablement plus long et doit être confirmé sur
                      place.
                    </span>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  clearRoute();
                  setRouteInfo(null);
                }}
                className="shrink-0 opacity-70 hover:opacity-100"
                aria-label="Effacer l'itinéraire"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          {/* Panneau des couches */}
          {layersOpen ? (
            <div className="absolute right-3 top-3 w-52 rounded-xl border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Couches</p>
                <button
                  type="button"
                  onClick={() => setLayersOpen(false)}
                  className="text-muted hover:text-ink"
                  aria-label="Fermer"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="space-y-1.5">
                {(
                  [
                    ["buildings2d", "Bâtiments (aplat)"],
                    ["buildings3d", "Bâtiments (volume)"],
                    ["markers", "Marqueurs"],
                    ["graphEdges", "Allées piétonnes"],
                    ["graphNodes", "Nœuds du réseau"],
                    ["route", "Itinéraire"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-ink"
                  >
                    {label}
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={() => toggleLayer(key)}
                      className="h-3.5 w-3.5 accent-[#35D6F5]"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Fiche détail : panneau latéral sur desktop, feuille sur mobile */}
          {selectedBuildingId ? (
            <>
              {/* Ancrée au viewport (`fixed`) et non au conteneur carte :
                  en `absolute`, la feuille dérivait dès que le document
                  scrollait (focus du champ de recherche sur mobile), et le
                  bouton « Itinéraire vers ce bâtiment » sortait sous l'écran
                  (mesuré à 918 px pour une fenêtre de 844 px).
                  `bottom-[57px]` laisse la barre de navigation inférieure
                  visible et cliquable. */}
              <div className="fixed inset-x-0 bottom-[57px] z-20 flex max-h-[60%] min-h-0 flex-col overflow-y-auto rounded-t-2xl border-t border-line bg-surface/97 shadow-2xl backdrop-blur lg:hidden">
                <button
                  type="button"
                  onClick={() => selectBuilding(null)}
                  aria-label="Fermer la fiche"
                  className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line"
                />
                <div className="min-h-0 flex-1">
                  <BuildingDetail
                    buildingId={selectedBuildingId}
                    fallback={selectedBuilding ?? undefined}
                    onClose={() => selectBuilding(null)}
                    onNavigate={(building) => {
                      routeToBuilding(building);
                      selectBuilding(null);
                    }}
                  />
                </div>
              </div>
              <div className="absolute bottom-3 right-3 top-3 z-20 hidden w-80 overflow-hidden rounded-xl border border-line bg-surface/97 shadow-2xl backdrop-blur lg:block">
                <BuildingDetail
                  buildingId={selectedBuildingId}
                  fallback={selectedBuilding ?? undefined}
                  onClose={() => selectBuilding(null)}
                  onNavigate={(building) => routeToBuilding(building)}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
