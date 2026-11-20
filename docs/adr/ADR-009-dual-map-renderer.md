# ADR-009 — Deux moteurs de rendu cartographique assumés

**Statut** : Accepté
**Date** : 2026-01
**Complète** : ADR-004

## Contexte

Contrainte forte du produit : la carte doit fonctionner sur un téléphone d'entrée de gamme (2 Go de RAM, GPU Mali ancien) **et** offrir une scène 3D immersive. Un seul moteur ne peut pas satisfaire les deux.

## Décision

Trois niveaux de rendu, choisis automatiquement puis surchargeables par l'utilisateur :

| Niveau | Moteur | Déclencheur automatique | Coût GPU |
|---|---|---|---|
| `vector-2d` | SVG/Canvas 2D maison (léger, zéro WebGL) | WebGL indisponible, `prefers-reduced-motion`, mode économie de batterie | ~0 |
| `maplibre-2d` | MapLibre GL (tuiles OSM + GeoJSON PostGIS) | défaut sur mobile et desktop | faible |
| `scene-3d` | React Three Fiber | desktop, ≥ 4 cœurs, pas de batterie faible | élevé |

## Détection et dégradation

1. Sonde WebGL (`canvas.getContext('webgl2')`) avant toute initialisation R3F — **jamais** de crash blanc silencieux.
2. `navigator.deviceMemory` < 4 ou `hardwareConcurrency` < 4 ⇒ `maplibre-2d` par défaut sur mobile.
3. `matchMedia('(prefers-reduced-motion: reduce)')` ⇒ désactive les animations 3D, conserve la 2D.
4. `battery.level < 0.2 && !battery.charging` ⇒ bascule automatique en 2D et affiche un toast explicatif.
5. Un `ErrorBoundary` autour du `<Canvas>` : si le contexte WebGL est perdu, bascule en 2D au lieu d'afficher un écran mort.

## Conséquences

- **La carte 2D est la garantie de disponibilité.** Elle ne dépend ni de WebGL, ni de R3F, ni de MapLibre (le rendu vectoriel maison reste le filet de sécurité final).
- Les fonctionnalités métier (navigation, présence, signalements) sont **identiques dans les trois modes** ; seule la représentation change.
- Les tests E2E vérifient au moins deux modes (vector-2d + scene-3d) pour détecter les régressions de parité.
