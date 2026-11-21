/**
 * Configuration Vitest — apps/web
 *
 * Deux problèmes à régler ici :
 *
 *  1. Les packages du monorepo (`@uac/geospatial`, `@uac/contracts`,
 *     `@uac/shared`) sont des sources TypeScript qui s'importent entre elles
 *     avec l'extension `.js` (style NodeNext : `./geo.js`). Next.js a besoin de
 *     `resolve.extensionAlias` pour cela (voir `next.config.mjs`) ; Vitest/Vite
 *     n'a pas d'équivalent natif, d'où le plugin ci-dessous qui réécrit
 *     `./x.js` → `./x.ts` lorsqu'un tel fichier existe. Sans lui, toute la
 *     suite échouerait sur `Failed to resolve import "./geo.js"`.
 *
 *  2. `graph-cache.ts` est écrit pour le navigateur (IndexedDB). On le teste
 *     sous Node avec `fake-indexeddb`, importé une seule fois pour installer
 *     les globales `indexedDB` / `IDBKeyRange`.
 */

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** Résout les imports `.js` du monorepo vers leur source `.ts` réelle. */
function tsExtensionAlias(): Plugin {
  const candidates = [".ts", ".tsx", ".mts"];
  return {
    name: "uac-ts-extension-alias",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer) return null;
      if (!source.endsWith(".js") && !source.endsWith(".mjs")) return null;
      // On ne touche qu'aux imports relatifs : les paquets node_modules
      // gardent leur extension d'origine.
      if (!source.startsWith(".")) return null;

      const base = resolvePath(dirname(importer), source);
      const stem = base.slice(0, base.length - (source.endsWith(".mjs") ? 4 : 3));
      for (const ext of candidates) {
        if (existsSync(stem + ext)) return { id: stem + ext };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tsExtensionAlias()],
  resolve: {
    alias: {
      "@": resolvePath(rootDir, "src"),
      "@uac/geospatial": resolvePath(rootDir, "../../packages/geospatial/src/index.ts"),
      "@uac/contracts": resolvePath(rootDir, "../../packages/contracts/src/index.ts"),
      "@uac/shared": resolvePath(rootDir, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    // `fake-indexeddb` s'installe globalement avant chaque fichier de test :
    // les tests IndexedDB ont besoin d'un IDB propre.
    setupFiles: ["./tests/setup-indexeddb.ts"],
  },
});
