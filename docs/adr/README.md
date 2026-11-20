# Architecture Decision Records — UAC-Live 3D

Index des décisions architecturales structurantes. Chaque ADR documente le **contexte**, la **décision**, les **alternatives écartées** et les **conséquences**.

| ID | Titre | Statut |
|----|-------|--------|
| [ADR-001](./ADR-001-modular-monolith.md) | Monolithe modulaire plutôt que microservices | Accepté |
| [ADR-002](./ADR-002-monorepo-pnpm-turbo.md) | Monorepo pnpm + Turborepo | Accepté |
| [ADR-003](./ADR-003-postgresql-postgis.md) | PostgreSQL 17 + PostGIS comme source de vérité | Accepté |
| [ADR-004](./ADR-004-maplibre-vs-custom-scene.md) | MapLibre GL pour la carte 2D, R3F pour la scène 3D | Accepté |
| [ADR-005](./ADR-005-auth-jwt-refresh-rotation.md) | JWT court + rotation de refresh tokens | Accepté |
| [ADR-006](./ADR-006-gps-privacy-model.md) | Modèle de confidentialité GPS à 4 modes | Accepté |
| [ADR-007](./ADR-007-offline-queue.md) | File d'attente hors ligne idempotente (operationId) | Accepté |
| [ADR-008](./ADR-008-redis-not-source-of-truth.md) | Redis = donnée volatile, jamais source de vérité | Accepté |
| [ADR-009](./ADR-009-dual-map-renderer.md) | Deux moteurs de rendu cartographique (2D vectoriel + 3D) | Accepté |
| [ADR-010](./ADR-010-contract-first-zod.md) | Contrats Zod partagés générant les types client/serveur | Accepté |

## Conventions

- Un ADR est **immuable** une fois accepté ; une révision crée un nouvel ADR qui supersède l'ancien.
- Toute décision touchant la sécurité, la donnée géographique ou la persistance exige un ADR.
