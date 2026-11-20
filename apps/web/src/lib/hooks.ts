"use client";

/**
 * Hooks de données — apps/web/src/lib/hooks.ts
 *
 * Chaque hook encapsule un endpoint réel. Aucune donnée de secours : quand le
 * serveur renvoie une liste vide, on renvoie une liste vide, et l'interface
 * affiche « aucun bâtiment » — jamais un tableau statique de démonstration.
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchBuildings,
  fetchBuilding,
  fetchBuildingRooms,
  fetchFaculties,
  fetchGraphMetadata,
  fetchHealth,
  fetchPedestrianGraph,
  fetchReports,
  type BuildingsQuery,
  type ReportsQuery,
} from "@/lib/api/endpoints";

/** Clés de cache centralisées : évite les fautes de frappe silencieuses. */
export const queryKeys = {
  health: ["health"] as const,
  faculties: ["faculties"] as const,
  buildings: (query: BuildingsQuery) => ["buildings", query] as const,
  building: (id: string) => ["building", id] as const,
  buildingRooms: (id: string) => ["building", id, "rooms"] as const,
  graph: ["graph"] as const,
  graphMetadata: ["graph", "metadata"] as const,
  reports: (query: ReportsQuery) => ["reports", query] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => fetchHealth({ signal }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useFaculties() {
  return useQuery({
    queryKey: queryKeys.faculties,
    queryFn: ({ signal }) => fetchFaculties({ signal }),
    staleTime: 5 * 60_000,
  });
}

/**
 * Liste des bâtiments.
 *
 * `limit: 100` couvre tout le campus actuel (15 bâtiments). On interroge une
 * seule page pour que la carte ait l'ensemble du bâti en une requête — paginer
 * une carte produirait des trous visuels.
 */
export function useBuildings(query: BuildingsQuery = { limit: 100 }) {
  const normalized: BuildingsQuery = { limit: 100, ...query };
  return useQuery({
    queryKey: queryKeys.buildings(normalized),
    queryFn: ({ signal }) => fetchBuildings(normalized, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useBuilding(id: string | null) {
  return useQuery({
    queryKey: queryKeys.building(id ?? "__none__"),
    queryFn: ({ signal }) => fetchBuilding(id!, { signal }),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useBuildingRooms(id: string | null) {
  return useQuery({
    queryKey: queryKeys.buildingRooms(id ?? "__none__"),
    queryFn: ({ signal }) => fetchBuildingRooms(id!, { signal }),
    enabled: Boolean(id),
    staleTime: 60 * 60_000,
  });
}

/** Métadonnées légères du graphe : sert à détecter un changement de version. */
export function useGraphMetadata() {
  return useQuery({
    queryKey: queryKeys.graphMetadata,
    queryFn: ({ signal }) => fetchGraphMetadata({ signal }),
    staleTime: 60_000,
  });
}

/**
 * Graphe piéton complet.
 *
 * Le téléchargement est déclenché à la demande (`enabled`) car il pèse plus
 * lourd que le reste : on ne le charge pas au premier rendu de la page d'accueil.
 */
export function usePedestrianGraph(enabled = false) {
  return useQuery({
    queryKey: queryKeys.graph,
    queryFn: ({ signal }) => fetchPedestrianGraph({ signal }),
    enabled,
    // Le graphe est validé manuellement côté terrain : on le garde longtemps.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function useReports(query: ReportsQuery = { limit: 20 }) {
  const normalized: ReportsQuery = { limit: 20, ...query };
  return useQuery({
    queryKey: queryKeys.reports(normalized),
    queryFn: ({ signal }) => fetchReports(normalized, { signal }),
    staleTime: 30_000,
  });
}
