import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Les tests d'intégration partagent la même base : pas de parallélisme
    // entre fichiers pour éviter les conflits d'écriture.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
});
