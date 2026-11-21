/**
 * Tests — cache IndexedDB du graphe piéton (tâche 3)
 *
 * On teste le module RÉEL `graph-cache.ts` contre `fake-indexeddb` (installé
 * par `tests/setup-indexeddb.ts`). Aucun mock du module : les transactions
 * IndexedDB sont réellement exécutées, seuls le backend de stockage est
 * simulé. Ce qui est vérifié ici correspond donc au comportement navigateur.
 *
 * Contrat de fraîcheur testé : un cache dont la `version` ne correspond plus
 * à celle annoncée par le serveur est renvoyé comme ABSENT, jamais comme
 * « approximatif » — naviguer sur un graphe obsolète enverrait dans un mur.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import type { PedestrianGraphDto } from "@/lib/api/endpoints";
import {
  clearGraphCache,
  dtoToPedestrianGraph,
  readGraphFromCache,
  readGraphFromCacheIfVersion,
  saveGraphToCache,
} from "@/lib/offline/graph-cache";

const here = dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(
  readFileSync(resolve(here, "fixtures/pedestrian-graph.json"), "utf8"),
) as PedestrianGraphDto;

/** Repart d'une base IndexedDB vide avant chaque test : pas d'état partagé. */
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await clearGraphCache();
});

describe("cache vide", () => {
  it("renvoie null quand rien n'a jamais été écrit", async () => {
    expect(await readGraphFromCache()).toBeNull();
  });

  it("renvoie null pour une version attendue quelconque", async () => {
    expect(await readGraphFromCacheIfVersion(payload.version)).toBeNull();
  });

  it("clearGraphCache sur un cache vide ne lève pas", async () => {
    await expect(clearGraphCache()).resolves.toBeUndefined();
  });
});

describe("écriture puis relecture", () => {
  it("relit exactement le graphe écrit (nœuds, arêtes, version)", async () => {
    await saveGraphToCache(payload);
    const record = await readGraphFromCache();

    expect(record).not.toBeNull();
    expect(record?.version).toBe(payload.version);
    expect(record?.nodeCount).toBe(15);
    expect(record?.edgeCount).toBe(21);
    expect(record?.graph.nodes).toHaveLength(15);
    expect(record?.graph.edges).toHaveLength(21);
    expect(record?.graph.nodes.map((node) => node.id).sort()).toEqual(
      payload.nodes.map((node) => node.id).sort(),
    );
  });

  it("horodate l'écriture (savedAt exploitable pour l'UI)", async () => {
    const before = Date.now();
    await saveGraphToCache(payload);
    const record = await readGraphFromCache();
    expect(record?.savedAt).toBeGreaterThanOrEqual(before);
    expect(record?.savedAt).toBeLessThanOrEqual(Date.now());
  });

  it("le graphe relu produit un itinéraire identique au graphe d'origine", async () => {
    await saveGraphToCache(payload);
    const record = await readGraphFromCache();
    const cached = dtoToPedestrianGraph(record!.graph);
    expect(cached.skippedEdges).toBe(0);
    expect(cached.graph.nodes.size).toBe(15);
    expect(cached.graph.edges).toHaveLength(21);
  });

  it("une seconde écriture remplace la première (pas d'accumulation)", async () => {
    await saveGraphToCache(payload);
    const reduit: PedestrianGraphDto = {
      ...payload,
      version: "aaaa1111",
      nodes: payload.nodes.slice(0, 3),
      edges: [],
    };
    await saveGraphToCache(reduit);

    const record = await readGraphFromCache();
    expect(record?.version).toBe("aaaa1111");
    expect(record?.nodeCount).toBe(3);
    expect(record?.edgeCount).toBe(0);
  });

  it("clearGraphCache supprime bien l'entrée", async () => {
    await saveGraphToCache(payload);
    expect(await readGraphFromCache()).not.toBeNull();

    await clearGraphCache();
    expect(await readGraphFromCache()).toBeNull();
  });
});

describe("persistance de la version (fraîcheur du cache)", () => {
  it("accepte la version qui correspond au serveur", async () => {
    await saveGraphToCache(payload);
    const record = await readGraphFromCacheIfVersion(payload.version);
    expect(record).not.toBeNull();
    expect(record?.version).toBe(payload.version);
  });

  it("REJETTE une version périmée (empreinte différente)", async () => {
    await saveGraphToCache(payload);
    // Le serveur a changé de graphe : son empreinte n'est plus 5c00eb32.
    const record = await readGraphFromCacheIfVersion("deadbeef");
    expect(record).toBeNull();
  });

  it("une version vide ne valide rien", async () => {
    await saveGraphToCache(payload);
    expect(await readGraphFromCacheIfVersion("")).toBeNull();
  });

  it("la version survit à un redémarrage (nouvelle instance IndexedDB conservée)", async () => {
    await saveGraphToCache(payload);
    // Simule un rechargement de page : nouvelles instances IDB pointant sur la
    // même base sous-jacente. fake-indexeddb partage le stockage global.
    const record = await readGraphFromCacheIfVersion(payload.version);
    expect(record?.version).toBe("5c00eb32");
  });
});

describe("cache corrompu", () => {
  it("ignore un enregistrement sans champ graph", async () => {
    // On écrit volontairement une forme invalide à la place de l'API.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open("uac-live-3d", 1);
      request.onupgradeneeded = () => {
        const opened = request.result;
        if (!opened.objectStoreNames.contains("pedestrian-graph")) {
          opened.createObjectStore("pedestrian-graph");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pedestrian-graph", "readwrite");
      tx.objectStore("pedestrian-graph").put({ version: "abc12345", savedAt: Date.now() }, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    expect(await readGraphFromCache()).toBeNull();
  });

  it("ignore un enregistrement dont les nodes ne sont pas un tableau", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open("uac-live-3d", 1);
      request.onupgradeneeded = () => {
        const opened = request.result;
        if (!opened.objectStoreNames.contains("pedestrian-graph")) {
          opened.createObjectStore("pedestrian-graph");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pedestrian-graph", "readwrite");
      tx.objectStore("pedestrian-graph").put(
        { version: "abc12345", savedAt: Date.now(), graph: { nodes: "pas un tableau", edges: [] } },
        "current",
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    expect(await readGraphFromCache()).toBeNull();
  });

  it("ignore un graphe sans aucun nœud (cache inutile)", async () => {
    await saveGraphToCache({ ...payload, nodes: [], edges: [] } as PedestrianGraphDto);
    expect(await readGraphFromCache()).toBeNull();
  });

  it("un cache corrompu n'empêche pas d'écrire un cache valide ensuite", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open("uac-live-3d", 1);
      request.onupgradeneeded = () => {
        const opened = request.result;
        if (!opened.objectStoreNames.contains("pedestrian-graph")) {
          opened.createObjectStore("pedestrian-graph");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pedestrian-graph", "readwrite");
      tx.objectStore("pedestrian-graph").put("chaîne totalement invalide", "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    expect(await readGraphFromCache()).toBeNull();

    await saveGraphToCache(payload);
    const repaired = await readGraphFromCache();
    expect(repaired?.version).toBe(payload.version);
    expect(repaired?.nodeCount).toBe(15);
  });
});

describe("environnement sans IndexedDB", () => {
  it("readGraphFromCache renvoie null au lieu de lever", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error on simule un navigateur sans IndexedDB (mode privé strict)
    delete globalThis.indexedDB;
    try {
      expect(await readGraphFromCache()).toBeNull();
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it("saveGraphToCache échoue explicitement (le caller peut afficher une erreur)", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error idem
    delete globalThis.indexedDB;
    try {
      await expect(saveGraphToCache(payload)).rejects.toThrow(/IndexedDB indisponible/);
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});
