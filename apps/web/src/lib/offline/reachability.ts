/**
 * Connectivité du graphe piéton — apps/web/src/lib/offline/reachability.ts
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Le réseau OSM importé est réel mais fragmenté : mesuré sur la base actuelle,
 * 55 composantes connexes, la plus grande comptant 40 nœuds sur 270 extrémités
 * distinctes. Les 354 nœuds `ENTRANCE` (points d'entrée des bâtiments) ont un
 * degré de 0 : aucun cheminement OSM ne les relie. Conséquence concrète : sur
 * 360 bâtiments, 6 seulement sont atteignables depuis un autre nœud.
 *
 * L'interface proposait pourtant les 536 nœuds dans ses deux listes déroulantes.
 * L'utilisateur pouvait donc choisir une destination mathématiquement
 * inatteignable, lancer le calcul, et lire « aucun chemin n'existe » — un échec
 * qui ressemblait à un bug alors qu'il décrivait une réalité du relevé.
 *
 * Ce module ne fabrique AUCUNE arête. Il se contente de calculer les composantes
 * connexes réelles pour que l'interface ne propose que des choix possibles, et
 * qu'elle dise explicitement ce qu'elle écarte et pourquoi.
 */

import type { PedestrianGraph } from "@uac/geospatial";

export interface Reachability {
  /** Identifiant de composante pour chaque nœud relié à au moins une arête. */
  componentOf: Map<string, number>;
  /** Nœuds de chaque composante, indexés par identifiant de composante. */
  membersOf: Map<number, string[]>;
  /** Nombre total de composantes connexes (hors nœuds isolés). */
  componentCount: number;
  /**
   * Nœuds sans aucune arête : ils existent dans le graphe (position connue)
   * mais ne mènent nulle part et ne sont joignables depuis nulle part.
   */
  isolatedNodeIds: Set<string>;
  /** Plus grande composante, en nombre de nœuds. */
  largestComponentSize: number;
}

/**
 * Calcule les composantes connexes par parcours en profondeur itératif.
 *
 * Itératif et non récursif : un graphe de plusieurs milliers de nœuds ferait
 * déborder la pile d'appels d'une récursion naïve.
 */
export function computeReachability(graph: PedestrianGraph): Reachability {
  const componentOf = new Map<string, number>();
  const membersOf = new Map<number, string[]>();
  const isolatedNodeIds = new Set<string>();

  // Degré effectif : un nœud n'est explorable que s'il touche une arête.
  const adjacency = new Map<string, string[]>();
  for (const nodeId of graph.nodes.keys()) adjacency.set(nodeId, []);
  for (const edge of graph.edges) {
    // Une arête dont une extrémité manque est ignorée : elle ne peut pas
    // rendre un nœud atteignable. On ne la « répare » pas.
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    adjacency.get(edge.target)!.push(edge.source);
  }

  let component = 0;
  for (const [nodeId, neighbours] of adjacency) {
    if (neighbours.length === 0) {
      isolatedNodeIds.add(nodeId);
      continue;
    }
    if (componentOf.has(nodeId)) continue;

    const members: string[] = [];
    const stack: string[] = [nodeId];
    componentOf.set(nodeId, component);

    while (stack.length > 0) {
      const current = stack.pop()!;
      members.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (componentOf.has(neighbour)) continue;
        componentOf.set(neighbour, component);
        stack.push(neighbour);
      }
    }

    membersOf.set(component, members);
    component++;
  }

  let largestComponentSize = 0;
  for (const members of membersOf.values()) {
    if (members.length > largestComponentSize) largestComponentSize = members.length;
  }

  return {
    componentOf,
    membersOf,
    componentCount: component,
    isolatedNodeIds,
    largestComponentSize,
  };
}

/**
 * Nœuds de la même composante que `nodeId`, triés par libellé.
 *
 * C'est la seule liste de destinations qu'il est honnête de proposer une fois
 * le départ choisi. Si `nodeId` est un nœud isolé, la liste est vide : mieux
 * vaut zéro choix qu'un choix qui échouera.
 */
export function destinationsFrom(
  graph: PedestrianGraph,
  reachability: Reachability,
  nodeId: string,
): Array<{ id: string; label: string }> {
  const component = reachability.componentOf.get(nodeId);
  if (component === undefined) return [];

  const members = reachability.membersOf.get(component) ?? [];
  return members
    .map((id) => {
      const node = graph.nodes.get(id);
      return { id, label: node?.label ?? id };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Nœuds proposables comme point de départ : ceux qui touchent au moins une
 * arête. Les 354 entrées de bâtiment isolées en sont exclues, sinon la liste
 * serait majoritairement composée de choix qui ne mènent à rien.
 */
export function selectableNodes(
  graph: PedestrianGraph,
  reachability: Reachability,
): Array<{ id: string; label: string; type: string }> {
  const result: Array<{ id: string; label: string; type: string }> = [];
  for (const [id, node] of graph.nodes) {
    if (reachability.isolatedNodeIds.has(id)) continue;
    result.push({ id, label: node.label ?? id, type: node.type });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
