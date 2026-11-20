# Dépendances entre modules

Ce document est **normatif**. Toute dépendance non listée ici est un défaut d'architecture à corriger en revue.

## 1. Graphe des packages (sens des flèches = « dépend de »)

```
                          ┌──────────────┐
                          │   contracts  │  (Zod : DTO + enveloppes)
                          └──────┬───────┘
                                 │
        ┌────────────────┬───────┴────────┬─────────────────┐
        │                │                │                 │
   ┌────▼────┐     ┌─────▼─────┐    ┌─────▼─────┐    ┌──────▼──────┐
   │ shared  │     │geospatial │    │ database  │    │    ui       │
   └────┬────┘     └─────┬─────┘    └─────┬─────┘    └──────┬──────┘
        │                │                │                 │
        │                │                │                 │
        └────────┬───────┴────────┬───────┴─────────────────┘
                 │                │
          ┌──────▼─────┐   ┌──────▼─────┐   ┌──────────────┐
          │  server    │   │    web     │   │    admin     │
          │ (Fastify)  │   │ (Next.js)  │   │  (Next.js)   │
          └────────────┘   └────────────┘   └──────────────┘
```

### Règles

| Depuis | Peut dépendre de | Ne peut **jamais** dépendre de |
|---|---|---|
| `shared` | — (zéro dépendance interne) | tout le reste |
| `contracts` | `shared` | `database`, `server`, `web`, `admin` |
| `geospatial` | `shared` | `database`, `contracts`, `server`, `web` |
| `database` | `shared`, `geospatial` | `server`, `web`, `admin`, `contracts` |
| `ui` | `shared` | `database`, `server`, `geospatial` |
| `config` | — | tout le reste |
| `server` | `shared`, `contracts`, `database`, `geospatial`, `config` | `web`, `admin`, `ui` |
| `web` | `shared`, `contracts`, `ui`, `geospatial`, `config` | `database`, `server` (sauf types) |
| `admin` | `shared`, `contracts`, `ui`, `config` | `database`, `server` |

**Interdits structurels** : aucun cycle entre packages ; `web` et `admin` ne parlent jamais à PostgreSQL directement — ils passent par l'API HTTP.

## 2. Frontières entre les 15 domaines métier du serveur

Un module ne peut appeler qu'une **interface applicative exportée** d'un autre module (`modules/<x>/application/index.ts`). Il ne peut jamais importer `modules/<x>/infrastructure/*` ni accéder directement à ses tables.

```
identity ──────► users ──────► presence ──────► navigation
    │              │              │                 │
    │              ├──────► social (friends)        │
    │              │              │                 │
    ▼              ▼              ▼                 ▼
  audit ◄──── reports ◄──── geography ◄──── buildings ────► rooms
    │              │              │                 │
    ▼              ▼              ▼                 ▼
moderation ◄───── sos ──────► notifications ◄── karma
                                                        │
                                                   gamification
```

### Dépendances autorisées (liste exhaustive)

| Module | Dépend de |
|---|---|
| `identity` | `shared`, `audit` |
| `users` | `identity`, `shared`, `audit` |
| `geography` | `shared`, `geospatial` |
| `buildings` | `geography`, `users`, `audit`, `karma` |
| `faculties` | `geography` |
| `rooms` | `buildings` |
| `contributions` | `buildings`, `users`, `karma`, `audit` |
| `social-presence` | `users`, `presence`, `geography` |
| `presence` | `users`, `geography` |
| `navigation` | `geography`, `geospatial`, `buildings` |
| `reports` | `geography`, `buildings`, `users`, `notifications`, `karma`, `audit` |
| `notifications` | `users` |
| `sos` | `users`, `geography`, `notifications`, `audit` |
| `karma` | `users`, `audit` |
| `moderation` | `users`, `audit` |
| `audit` | — |

**Règle de résolution de cycle** : si deux modules ont besoin l'un de l'autre, l'un des deux doit être inversé via un **événement de domaine** (bus interne) plutôt qu'un import direct.

## 3. Ordre de construction (respecte le graphe)

```
shared → config → contracts → geospatial → database → server → ui → web → admin
```

Turborepo applique cet ordre automatiquement via `dependsOn: ["^build"]`.
