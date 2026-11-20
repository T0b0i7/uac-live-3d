"use client";

/**
 * Téléchargement, persistance et usage hors-ligne du graphe piéton.
 * apps/web/src/lib/offline/useGraph.ts
 *
 * Cycle de vie :
 *  1. on lit la version annoncée par `/navigation/graph` (sans `?full=1`) ;
 *  2. si le cache IndexedDB porte cette version → on l'utilise, zéro réseau ;
 *  3. sinon on télécharge `?full=1`, on valide, on persiste ;
 *  4. si le réseau échoue mais qu'un cache existe → on l'utilise en le signalant
 *     comme périmé, jamais en le présentant comme à jour.
 *
 * L'étape 1 est ce qui rend le cache économique : comparer 8 octets d'empreinte
 * coûte infiniment moins que retélécharger tout le graphe.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/hooks";
import {
  clearGraphCache,
  computeLocalRoute,
  computeRouteBetweenNodes,
  dtoToPedestrianGraph,
  inspectGraph,
  readGraphFromCache,
  readGraphFromCacheIfVersion,
  saveGraphToCache,
  type CachedGraphRecord,
  type LocalRouteResult,
  type PathOptions,
  type PedestrianGraph,
} from "@/lib/offline/graph-cache";
import { fetchPedestrianGraph, fetchGraphMetadata, type PedestrianGraphDto } from "@/lib/api/endpoints";

export interface GraphLoadState {
  /** Graphe prêt à l'emploi (réseau ou cache). */
  payload: PedestrianGraphDto | null;
  /** Structure exploitable par les algorithmes. */
  graph: PedestrianGraph | null;
  /** Origine de la donnée : indispensable pour ne pas mentir à l'utilisateur. */
  source: "network" | "cache" | "stale-cache" | null;
  version: string | null;
  savedAt: number | null;
  isLoading: boolean;
  error: ApiError | null;
  /** Arêtes écartées parce qu'elles référençaient un nœud absent. */
  skippedEdges: number;
  problems: string[];
}

export function usePedestrianGraphOffline(): GraphLoadState & {
  download: () => Promise<void>;
  clear: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const [payload, setPayload] = useState<PedestrianGraphDto | null>(null);
  const [source, setSource] = useState<GraphLoadState["source"]>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [skippedEdges, setSkippedEdges] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);

  const metadataQuery = useQuery({
    queryKey: queryKeys.graphMetadata,
    staleTime: 30_000,
  });

  const derive = useCallback((record: CachedGraphRecord, from: GraphLoadState["source"]) => {
    const { graph, skippedEdges: skipped } = dtoToPedestrianGraph(record.graph);
    const { valid, problems } = inspectGraph(graph);
    setPayload(record.graph);
    setSource(from);
    setSavedAt(record.savedAt);
    setSkippedEdges(skipped);
    setError(null);
    // On publie aussi dans le cache TanStack pour que les autres écrans en profitent.
    queryClient.setQueryData(queryKeys.graph, record.graph);
    return { graph, valid, problems };
  }, [queryClient]);

  const download = useCallback(async () => {
    setError(null);
    try {
      const fresh = await fetchPedestrianGraph();
      await saveGraphToCache(fresh);
      const record: CachedGraphRecord = {
        version: fresh.version,
        savedAt: Date.now(),
        nodeCount: fresh.nodes.length,
        edgeCount: fresh.edges.length,
        graph: fresh,
      };
      derive(record, "network");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("NETWORK_ERROR", "Téléchargement du graphe impossible.", 0),
      );
    }
  }, [derive]);

  const clear = useCallback(async () => {
    await clearGraphCache();
    setPayload(null);
    setSource(null);
    setSavedAt(null);
    setSkippedEdges(0);
    queryClient.removeQueries({ queryKey: queryKeys.graph });
  }, [queryClient]);

  // Chargement initial : cache correspondant à la version serveur, sinon rien.
  const [hydrated, setHydrated] = useState(false);
  const [bootstrapProblem, setBootstrapProblem] = useState<string[]>([]);

  const hydrate = useCallback(async () => {
    if (hydrated) return;
    setHydrated(true);
    try {
      const meta = await fetchGraphMetadata();
      const exact = await readGraphFromCacheIfVersion(meta.version);
      if (exact) {
        derive(exact, "cache");
        return;
      }
      const anyRecord = await readGraphFromCache();
      if (anyRecord) {
        // Version différente : on ne l'utilise PAS automatiquement (graphe
        // potentiellement obsolète), mais on le signale comme disponible.
        setSavedAt(anyRecord.savedAt);
        setBootstrapProblem([
          `Graphe en cache obsolète (version ${anyRecord.version} ≠ ${meta.version}). Téléchargez la mise à jour.`,
        ]);
      }
    } catch {
      // Pas de réseau : on tentera de réutiliser le cache à la demande.
      const anyRecord = await readGraphFromCache();
      if (anyRecord) {
        derive(anyRecord, "stale-cache");
      }
    }
  }, [derive, hydrated]);

  // `useQuery` avec une clé dédiée pour déclencher l'hydratation une seule fois,
  // de façon compatible avec le cycle de rendu React.
  useQuery({
    queryKey: ["graph", "hydrate"],
    queryFn: async () => {
      await hydrate();
      return true;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  const graph = useMemo(() => {
    if (!payload) return null;
    return dtoToPedestrianGraph(payload).graph;
  }, [payload]);

  const problems = useMemo(() => {
    if (!graph) return bootstrapProblem;
    return [...bootstrapProblem, ...inspectGraph(graph).problems];
  }, [graph, bootstrapProblem]);

  return {
    payload,
    graph,
    source,
    version: payload?.version ?? null,
    savedAt,
    isLoading: metadataQuery.isLoading && !payload,
    error: error ?? (metadataQuery.error as ApiError | null),
    skippedEdges,
    problems,
    download,
    clear,
  };
}

/**
 * Itinéraire local, recalculé quand le graphe ou les extrémités changent.
 *
 * Renvoie `null` tant que le graphe n'est pas disponible : l'interface affiche
 * alors un état de chargement, jamais un itinéraire inventé.
 */
export function useLocalRoute(
  graph: PedestrianGraph | null,
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  options: PathOptions & { algorithm?: "dijkstra" | "astar" } = {},
): LocalRouteResult | null {
  return useMemo(() => {
    if (!graph || graph.nodes.size === 0) return null;
    if (!from || !to) return null;
    return computeLocalRoute(graph, from, to, options);
    // Les options sont des scalaires : on les liste pour un memo stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, from?.lat, from?.lng, to?.lat, to?.lng, options.accessibleOnly, options.algorithm]);
}

export { computeRouteBetweenNodes };
export type { LocalRouteResult, PedestrianGraph };
