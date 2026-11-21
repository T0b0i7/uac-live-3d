/**
 * Installe une implémentation IndexedDB en mémoire pour les tests Node.
 *
 * `fake-indexeddb` fournit `IDBFactory`, `IDBKeyRange`, etc. On les expose
 * comme globales pour que `graph-cache.ts` (écrit pour le navigateur) trouve
 * `indexedDB` sans aucune modification.
 */

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

declare global {
  // eslint-disable-next-line no-var
  var indexedDB: IDBFactory;
  // eslint-disable-next-line no-var
  var IDBKeyRange: typeof IDBKeyRange;
}

globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;
