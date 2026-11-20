# ADR-004 — MapLibre GL pour la carte 2D, React Three Fiber pour la scène 3D

**Statut** : Accepté
**Date** : 2026-01
**Supersède partiellement** : le prototype initial qui rendait la carte 2D en SVG maison.

## Contexte

Le prototype v1 dessinait la carte 2D en SVG généré à la main. C'était suffisant pour une démonstration figée (~14 bâtiments) mais devient intenable dès que l'on veut du géoréférencement réel, du zoom fluide sur des centaines de polygones, du clustering et des tuiles OpenStreetMap.

Deux besoins distincts coexistent :
- une **carte géographique exacte** (tuiles OSM, polygones géoréférencés, navigation, couches superposables) ;
- une **visualisation 3D spectaculaire** (jumeau numérique stylisé, non métrique).

## Décision

- **Carte 2D et navigation** → **MapLibre GL JS** (fork open-source de Mapbox GL, licence BSD, aucun token requis) avec source tuilée OSM raster + couches GeoJSON applicatives. PostGIS alimente les GeoJSON.
- **Scène 3D** → **React Three Fiber + drei**, conservée comme *jumeau numérique stylisé*. Elle n'a **aucune prétention métrique** : la géométrie est déclarative et documentée comme telle.

## Règle d'honnêteté produit

Un même bâtiment possède une géométrie PostGIS (réelle, `4326`) et une géométrie de scène 3D (locale, en mètres arbitraires). Les deux sont liées par `building.id` ; **aucune conversion implicite** n'est faite entre elles. L'interface indique explicitement laquelle on regarde.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Mapbox GL JS | Token + facturation par chargement de tuiles |
| Leaflet | Excellent mais rendu raster uniquement, pas d'extrusion ni de couches vectorielles fluides |
| Google Maps | Coût, dépendance fournisseur, conditions d'usage sur les données dérivées |
| CesiumJS | Globe complet surdimensionné pour un campus ; poids bundle prohibitif |
| Tout faire en R3F | Impossible de géoréférencer correctement des milliers de polygones réels |

## Conséquences

Deux moteurs = deux fois la surface de test, mais deux fois la valeur : la carte sert la **fonction** (naviguer, localiser), la 3D sert l'**attachement émotionnel** au campus.
