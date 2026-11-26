"use client";

/**
 * Page navigation — apps/web/src/app/navigation/page.tsx
 *
 * Le graphe est téléchargé puis PERSISTÉ (IndexedDB). L'itinéraire est calculé
 * localement avec Dijkstra ou A* (`@uac/geospatial`). On affiche côte à côte le
 * résultat des deux algorithmes : s'ils divergent sur la distance, c'est le
 * signe d'un problème d'heuristique, et l'utilisateur doit le voir.
 *
 * Aucune donnée de démo : sans graphe, la page propose de le télécharger.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Download,
  Database,
  Trash2,
  Wifi,
  WifiOff,
  Accessibility,
  GitBranch,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, SkeletonBlock } from "@/components/ui/States";
import { usePedestrianGraphOffline } from "@/lib/offline/useGraph";
import { computeRouteBetweenNodes } from "@/lib/offline/graph-cache";
import {
  computeReachability,
  destinationsFrom,
  selectableNodes,
} from "@/lib/offline/reachability";

export default function NavigationPage() {
  const graphState = usePedestrianGraphOffline();
  const [startId, setStartId] = useState<string>("");
  const [endId, setEndId] = useState<string>("");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expandedProblem, setExpandedProblem] = useState<string | null>(null);

  const graph = graphState.graph;

  /**
   * Connectivité réelle du graphe.
   *
   * Les listes déroulantes proposaient auparavant les 536 nœuds, y compris les
   * 354 points d'entrée de bâtiments qui n'ont AUCUNE arête : choisir l'un
   * d'eux ne pouvait que produire « aucun chemin n'existe ». On ne fabrique pas
   * de tronçons pour combler ces trous (ce serait inventer des cheminements) ;
   * on cesse simplement de proposer des destinations impossibles, et on dit
   * combien de nœuds sont écartés.
   */
  const reachability = useMemo(() => (graph ? computeReachability(graph) : null), [graph]);

  /** Départs possibles : uniquement les nœuds reliés à au moins une arête. */
  const startOptions = useMemo(() => {
    if (!graph || !reachability) return [];
    return selectableNodes(graph, reachability);
  }, [graph, reachability]);

  /**
   * Arrivées possibles : uniquement les nœuds de la MÊME composante connexe
   * que le départ. C'est la garantie qu'un itinéraire existe avant même de
   * lancer le calcul.
   */
  const destinationOptions = useMemo(() => {
    if (!graph || !reachability || !startId) return [];
    return destinationsFrom(graph, reachability, startId).filter((n) => n.id !== startId);
  }, [graph, reachability, startId]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    await graphState.download();
    setDownloading(false);
  }, [graphState]);

  const routes = useMemo(() => {
    if (!graph || !startId || !endId || startId === endId) return null;
    const options = { accessibleOnly };
    return {
      astar: computeRouteBetweenNodes(graph, startId, endId, { ...options, algorithm: "astar" }),
      dijkstra: computeRouteBetweenNodes(graph, startId, endId, {
        ...options,
        algorithm: "dijkstra",
      }),
    };
  }, [graph, startId, endId, accessibleOnly]);

  const divergence = useMemo(() => {
    if (!routes?.astar.found || !routes?.dijkstra.found) return null;
    return Math.abs(routes.astar.distanceMeters - routes.dijkstra.distanceMeters);
  }, [routes]);

  /**
   * Regroupement des avertissements du graphe par catégorie.
   *
   * `inspectGraph` émet un message par nœud isolé, soit 354 lignes pour le seul
   * motif « nœud isolé ». Les afficher telles quelles saturait le panneau. On
   * compte par motif et on garde la liste détaillée accessible à la demande.
   */
  const problemGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const problem of graphState.problems) {
      // Motif = texte avant les deux-points, ex. « nœud isolé ».
      const sep = problem.indexOf(":");
      const label = sep > 0 ? problem.slice(0, sep).trim() : problem;
      const detail = sep > 0 ? problem.slice(sep + 1).trim() : problem;
      const list = groups.get(label) ?? [];
      list.push(detail);
      groups.set(label, list);
    }
    return Array.from(groups, ([label, items]) => ({
      label,
      count: items.length,
      items,
    })).sort((a, b) => b.count - a.count);
  }, [graphState.problems]);

  return (
    <AppShell
      title="Navigation piétonne"
      subtitle="Graphe réel du campus, calcul local Dijkstra / A*"
      actions={
        graphState.payload ? (
          <button
            type="button"
            onClick={() => void graphState.clear()}
            className="rounded-lg border border-line bg-surface p-1.5 text-muted transition hover:text-danger"
            aria-label="Vider le cache local"
          >
            <Trash2 size={15} />
          </button>
        ) : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ---------- Colonne gauche : état du graphe + formulaire ---------- */}
        <div className="space-y-3">
          <div className="rounded-xl2 border border-line bg-surface/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
                Graphe piéton
              </p>
              {graphState.source ? (
                <span
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    graphState.source === "network"
                      ? "bg-ok/15 text-ok"
                      : graphState.source === "cache"
                        ? "bg-primary/15 text-primary"
                        : "bg-warn/15 text-warn"
                  }`}
                >
                  {graphState.source === "network" ? (
                    <>
                      <Wifi size={9} /> téléchargé
                    </>
                  ) : graphState.source === "cache" ? (
                    <>
                      <Database size={9} /> cache
                    </>
                  ) : (
                    <>
                      <WifiOff size={9} /> cache périmé
                    </>
                  )}
                </span>
              ) : null}
            </div>

            {graphState.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-3 w-2/3" />
              </div>
            ) : graphState.payload ? (
              <dl className="space-y-1.5 text-xs">
                <Line label="Nœuds" value={String(graphState.payload.nodes.length)} />
                <Line label="Allées" value={String(graphState.payload.edges.length)} />
                <Line
                  label="Accessibles PMR"
                  value={`${graphState.payload.accessibleEdgeCount} / ${graphState.payload.edges.length}`}
                />
                <Line label="Version" value={graphState.version ?? "—"} mono />
                {graphState.savedAt ? (
                  <Line
                    label="Enregistré"
                    value={new Date(graphState.savedAt).toLocaleString("fr-FR")}
                  />
                ) : null}
                {graphState.skippedEdges > 0 ? (
                  <Line
                    label="Arêtes ignorées"
                    value={String(graphState.skippedEdges)}
                    tone="warn"
                  />
                ) : null}
              </dl>
            ) : graphState.error ? (
              <ErrorState error={graphState.error} onRetry={handleDownload} compact />
            ) : (
              <p className="text-xs text-muted">
                Le graphe n'est pas encore en cache. Téléchargez-le une fois : il restera
                disponible hors ligne.
              </p>
            )}

            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-[#04121a] transition hover:brightness-110 disabled:opacity-60"
            >
              <Download size={13} />
              {downloading
                ? "Téléchargement…"
                : graphState.payload
                  ? "Mettre à jour le graphe"
                  : "Télécharger le graphe"}
            </button>

            {/*
              Les 354 points d'entrée non raccordés produisaient 354 lignes
              « • nœud isolé: X » : la liste noyait le reste du panneau et
              repoussait le formulaire hors de l'écran. Une ligne par catégorie
              dit la même chose en restant lisible ; le détail complet reste
              disponible en dépliant, pour ne rien cacher.
            */}
            {problemGroups.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {problemGroups.map((group) => (
                  <div key={group.label} className="text-[10px] leading-relaxed text-warn">
                    <p>
                      • {group.count} {group.label}
                      {group.items.length > 3 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProblem((current) =>
                              current === group.label ? null : group.label,
                            )
                          }
                          className="ml-1 underline decoration-dotted hover:text-ink"
                        >
                          {expandedProblem === group.label ? "masquer" : "voir"}
                        </button>
                      ) : null}
                    </p>
                    {expandedProblem === group.label ? (
                      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-3 text-muted/80">
                        {group.items.map((item, i) => (
                          <li key={`${group.label}-${i}`} className="font-mono">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {graphState.payload?.disclaimer ? (
              <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-muted/70">
                {graphState.payload.disclaimer}
              </p>
            ) : null}
          </div>

          {/* Formulaire */}
          <div className="rounded-xl2 border border-line bg-surface/60 p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted">
              Itinéraire
            </p>

            {!graph ? (
              <p className="text-xs text-muted">
                Téléchargez d'abord le graphe pour choisir un départ et une arrivée.
              </p>
            ) : (
              <div className="space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">
                    Départ
                  </span>
                  <select
                    value={startId}
                    onChange={(e) => {
                      setStartId(e.target.value);
                      // La destination précédente n'appartient peut-être pas à
                      // la même composante : on la réinitialise plutôt que de
                      // laisser une combinaison qui échouera à coup sûr.
                      setEndId("");
                    }}
                    className="w-full rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-ink focus:border-primary/60 focus:outline-none"
                  >
                    <option value="">Choisir un nœud…</option>
                    {startOptions.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px] text-muted/70">
                    {startOptions.length} nœud{startOptions.length > 1 ? "s" : ""} relié
                    {startOptions.length > 1 ? "s" : ""} au réseau
                    {reachability && reachability.isolatedNodeIds.size > 0
                      ? ` · ${reachability.isolatedNodeIds.size} écarté${reachability.isolatedNodeIds.size > 1 ? "s" : ""} (aucun cheminement rattaché)`
                      : ""}
                  </span>
                </label>

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      const s = startId;
                      setStartId(endId);
                      setEndId(s);
                    }}
                    className="rounded-lg border border-line p-1.5 text-muted transition hover:text-primary"
                    aria-label="Inverser départ et arrivée"
                  >
                    <ArrowRightLeft size={13} />
                  </button>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">
                    Arrivée
                  </span>
                  <select
                    value={endId}
                    onChange={(e) => setEndId(e.target.value)}
                    disabled={!startId}
                    className="w-full rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-ink focus:border-primary/60 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">
                      {startId ? "Choisir un nœud…" : "Choisissez d'abord un départ"}
                    </option>
                    {destinationOptions.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                  {startId ? (
                    <span className="mt-1 block text-[10px] text-muted/70">
                      {destinationOptions.length} destination
                      {destinationOptions.length > 1 ? "s" : ""} atteignable
                      {destinationOptions.length > 1 ? "s" : ""} depuis ce départ
                    </span>
                  ) : null}
                </label>

                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-ink">
                  <Accessibility size={13} className="text-ok" />
                  Chemin accessible PMR uniquement
                  <input
                    type="checkbox"
                    checked={accessibleOnly}
                    onChange={(e) => setAccessibleOnly(e.target.checked)}
                    className="ml-auto h-3.5 w-3.5 accent-[#35D6F5]"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* ---------- Colonne droite : résultats ---------- */}
        <div className="space-y-3">
          {!graph ? (
            <EmptyState
              title="Aucun graphe chargé"
              description="Le calcul d'itinéraire s'appuie sur le réseau d'allées réel enregistré en base. Téléchargez-le pour commencer."
              icon={<GitBranch size={26} />}
            />
          ) : !startId || !endId ? (
            <EmptyState
              title="Choisissez un départ et une arrivée"
              description="Les deux extrémités doivent être des nœuds du réseau piéton réel."
              icon={<GitBranch size={26} />}
            />
          ) : startId === endId ? (
            <EmptyState title="Départ et arrivée identiques" description="Choisissez deux nœuds différents." />
          ) : routes && !routes.astar.found && !routes.dijkstra.found ? (
            <EmptyState
              title="Aucun chemin n'existe"
              description={
                accessibleOnly
                  ? "Aucun itinéraire entièrement accessible PMR ne relie ces deux nœuds. Décochez l'option pour voir le chemin général."
                  : "Ces deux nœuds ne sont pas connectés dans le graphe actuel."
              }
              icon={<GitBranch size={26} />}
            />
          ) : routes ? (
            <>
              <div className="rounded-xl2 border border-primary/35 bg-primary/8 p-4">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-primary">
                  Itinéraire le plus court
                </p>
                <p className="text-2xl font-semibold text-ink">
                  {Math.round(routes.astar.distanceMeters)} m
                  <span className="ml-2 text-sm font-normal text-muted">
                    ≈ {Math.round(routes.astar.estimatedMinutes)} min à pied
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                  <span>{routes.astar.nodeIds.length} nœuds traversés</span>
                  <span>vol d'oiseau {Math.round(routes.astar.straightLineMeters)} m</span>
                  {routes.astar.usesNonAccessible ? (
                    <span className="text-warn">emprunte une allée non accessible</span>
                  ) : (
                    <span className="text-ok">entièrement accessible</span>
                  )}
                </div>
              </div>

              {/* Comparaison des algorithmes : preuve que le calcul est réel */}
              <div className="grid gap-3 sm:grid-cols-2">
                <AlgoCard
                  name="A*"
                  heuristic="heuristique Haversine"
                  meters={routes.astar.distanceMeters}
                  explored={routes.astar.exploredNodes}
                  found={routes.astar.found}
                />
                <AlgoCard
                  name="Dijkstra"
                  heuristic="exploration uniforme"
                  meters={routes.dijkstra.distanceMeters}
                  explored={routes.dijkstra.exploredNodes}
                  found={routes.dijkstra.found}
                />
              </div>

              {divergence !== null ? (
                <div
                  className={`rounded-lg border px-3 py-2 text-[11px] ${
                    divergence < 0.5
                      ? "border-ok/30 bg-ok/8 text-ok"
                      : "border-warn/35 bg-warn/8 text-warn"
                  }`}
                >
                  {divergence < 0.5
                    ? `Les deux algorithmes donnent la même distance (écart ${divergence.toFixed(2)} m) : cohérent.`
                    : `Écart de ${divergence.toFixed(2)} m entre A* et Dijkstra — à investiguer.`}
                </div>
              ) : null}

              {/* Étapes */}
              <div className="rounded-xl2 border border-line bg-surface/60 p-4">
                <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                  Chemin détaillé
                </p>
                <ol className="space-y-1.5">
                  {routes.astar.nodeIds.map((nodeId, index) => {
                    const node = graph.nodes.get(nodeId);
                    return (
                      <li key={`${nodeId}-${index}`} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[9px] text-primary">
                          {index + 1}
                        </span>
                        <span className="min-w-0 text-xs text-ink">
                          {node?.label ?? nodeId}
                          <span className="ml-1.5 font-mono text-[10px] text-muted">
                            {node?.type.toLowerCase()}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function Line({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd
        className={`text-right text-[11px] font-medium ${
          tone === "warn" ? "text-warn" : "text-ink"
        } ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function AlgoCard({
  name,
  heuristic,
  meters,
  explored,
  found,
}: {
  name: string;
  heuristic: string;
  meters: number;
  explored: number;
  found: boolean;
}) {
  return (
    <div className="rounded-xl2 border border-line bg-surface/60 p-3.5">
      <p className="text-xs font-semibold text-ink">{name}</p>
      <p className="mb-2 text-[10px] text-muted">{heuristic}</p>
      {found ? (
        <>
          <p className="text-lg font-semibold text-ink">{Math.round(meters)} m</p>
          <p className="text-[10px] text-muted">{explored} nœuds explorés</p>
        </>
      ) : (
        <p className="text-xs text-danger">Aucun chemin trouvé</p>
      )}
    </div>
  );
}
