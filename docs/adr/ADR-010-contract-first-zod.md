# ADR-010 — API contract-first avec Zod partagé

**Statut** : Accepté
**Date** : 2026-01

## Contexte

Client Next.js, serveur Fastify et console d'administration doivent parler exactement le même langage. Trois façons de définir les formes de données (types TS, schémas OpenAPI, schémas Zod) créent trois vérités divergentes.

## Décision

**`packages/contracts` est la source unique.** Chaque route a :

1. un **schéma d'entrée** Zod (`body`, `query`, `params`) ;
2. un **schéma de sortie** Zod ;
3. des types inférés via `z.infer` — jamais écrits à la main.

Le serveur valide l'entrée avec le schéma **avant** d'atteindre le handler et valide la sortie en développement (mode `strictResponses`), ce qui attrape immédiatement les champs manquants. La documentation OpenAPI est générée à partir des mêmes schémas (`@fastify/swagger` + `zod-to-json-schema`), pas écrite séparément.

## Format d'enveloppe unique

```ts
// Succès
{ data: T, meta?: { page, limit, total, hasMore } }
// Erreur
{ error: { code: string, message: string, details?: unknown, requestId: string } }
```

Aucun endpoint ne renvoie de forme ad hoc. Le client peut donc traiter les erreurs de manière générique et typée (`ApiError`).

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| `tRPC` | Excellent mais couple client et serveur en TypeScript uniquement ; empêche des clients tiers (app mobile native future, intégrations UAC) |
| OpenAPI **généré puis** types TS | Chaîne d'outillage lourde, dérive possible entre le YAML et les validations réellement appliquées |
| GraphQL | Sur-dimensionné ; la majorité des lectures sont des listes filtrées simples ; complexité de cache supérieure |
| Schémas Zod dupliqués côté client | Dérive garantie à la première évolution |

## Conséquences

Toute évolution d'API commence par l'édition du contrat dans `packages/contracts`. Le typecheck échoue partout où le changement casse quelque chose — c'est le but.
