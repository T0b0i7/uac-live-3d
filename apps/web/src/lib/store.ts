"use client";

/**
 * État d'interface partagé — apps/web/src/lib/store.ts
 *
 * Zustand ne stocke ici que de l'état ÉPHÉMÈRE d'interface (sélection, couches,
 * mode de la carte). Les données du serveur restent la propriété de TanStack
 * Query : dupliquer des données distantes dans un store local est la première
 * cause de désynchronisation.
 */

import { create } from "zustand";

/** Couches cartographiques activables par l'utilisateur. */
export interface LayerVisibility {
  buildings2d: boolean;
  buildings3d: boolean;
  markers: boolean;
  graphEdges: boolean;
  graphNodes: boolean;
  route: boolean;
}

export type MapMode = "2d" | "3d";

interface AppState {
  /** Bâtiment actuellement sélectionné (id), partagé entre carte et liste. */
  selectedBuildingId: string | null;
  selectBuilding: (id: string | null) => void;

  layers: LayerVisibility;
  toggleLayer: (layer: keyof LayerVisibility) => void;
  setLayer: (layer: keyof LayerVisibility, value: boolean) => void;

  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;

  /** Itinéraire courant, produit par le calcul local Dijkstra/A*. */
  routeNodeIds: string[];
  setRoute: (nodeIds: string[]) => void;
  clearRoute: () => void;

  /** Panneau de détail ouvert sur mobile (bottom sheet). */
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedBuildingId: null,
  selectBuilding: (id) =>
    set({ selectedBuildingId: id, detailOpen: id !== null }),

  layers: {
    buildings2d: true,
    buildings3d: false,
    markers: true,
    graphEdges: false,
    graphNodes: false,
    route: true,
  },
  toggleLayer: (layer) =>
    set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  setLayer: (layer, value) =>
    set((state) => ({ layers: { ...state.layers, [layer]: value } })),

  mapMode: "2d",
  setMapMode: (mode) =>
    set((state) => ({
      mapMode: mode,
      layers: {
        ...state.layers,
        // En 3D on affiche les volumes extrudés et on masque l'aplat, pour
        // éviter le z-fighting entre les deux représentations.
        buildings3d: mode === "3d",
        buildings2d: mode === "2d",
      },
    })),

  routeNodeIds: [],
  setRoute: (nodeIds) => set({ routeNodeIds: nodeIds }),
  clearRoute: () => set({ routeNodeIds: [] }),

  detailOpen: false,
  setDetailOpen: (open) => set({ detailOpen: open }),
}));
