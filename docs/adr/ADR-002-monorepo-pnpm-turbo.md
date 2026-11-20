# ADR-002 — Monorepo pnpm + Turborepo

**Statut** : Accepté
**Date** : 2026-01

## Contexte

Trois applications (`web`, `server`, `admin`) partagent des types, des schémas de validation et des composants d'interface. Sans monorepo, chaque changement de contrat API provoquerait une désynchronisation silencieuse entre client et serveur.

## Décision

Monorepo **pnpm workspaces** (liens symboliques stricts, pas de dépendances fantômes) orchestré par **Turborepo** (graphe de tâches + cache incrémental). TypeScript en mode `strict` depuis un `tsconfig.base.json` unique.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Trois dépôts séparés | Contrats API dupliqués ; régressions découvertes en production |
| npm workspaces | Résolution plus permissive (hoisting) → dépendances non déclarées passent inaperçues |
| Nx | Puissant mais surdimensionné ; courbe d'apprentissage generators/executors non justifiée ici |
| Yarn PnP | Incompatibilités connues avec certains outils (drizzle-kit, Playwright) |

## Conséquences

`packages/contracts` devient la **source unique** des schémas Zod : le serveur valide avec, le client infère ses types avec (`z.infer`). Une rupture de contrat devient une erreur de compilation, pas un bug de production.
