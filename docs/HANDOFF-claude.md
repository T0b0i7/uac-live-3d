# UAC-Live 3D — Dossier de passation complet

> Document destiné à un autre agent (Claude) chargé d'améliorer le projet.
> Rédigé le 24 novembre 2026 après exécution de chaque vérification citée.
> **Règle de lecture** : tout ce qui suit est mesuré par commande. Ce qui n'a pas
> été vérifié est explicitement marqué « NON VÉRIFIÉ ».

---

## 0. Résumé en dix lignes

UAC-Live 3D est une application web de cartographie et de navigation piétonne du
campus de l'Université d'Abomey-Calavi (Bénin). Monorepo TypeScript : Next.js 15
pour le front, Fastify 5 + PostgreSQL 17 + PostGIS 3.5 pour l'API, données
géographiques réelles importées d'OpenStreetMap (355 bâtiments, 117 cheminements).
L'infrastructure fonctionne : base de données peuplée, API opérationnelle,
interface soignée. **Mais l'application est actuellement inutilisable** :
trois défauts bloquants empêchent l'affichage des bâtiments, ne laissent aucun
itinéraire calculable, et le graphe piéton est vide. Le premier est une
incohérence de contrat de trois caractères (`OSM_IMPORT` vs `OSM`) qui fait
échouer la validation Zod des 100 bâtiments. Le deuxième est un plafond de
pagination. Le troisième est un référentiel de codes de bâtiments incohérent
entre deux tables — et la table de correspondance qui existe déjà en base ne
couvre que 11 allées sur 21 avec des écarts de 255 à 780 m, donc elle ne peut
pas être utilisée telle quelle. Aucun de ces défauts n'est esthétique : ils sont
tous corrigeables, mais le troisième demande de la méthode, pas un raccourci.

---

## 1. Ce qu'est le projet

| Élément | Valeur mesurée |
|---|---|
| Nom | UAC-Live 3D |
| Objet | Carte 3D et navigation piétonne du campus UAC, Abomey-Calavi, Bénin |
| Dépôt GitHub | `https://github.com/T0b0i7/uac-live-3d` (branche `main`, HEAD `ced3041`) |
| Nature | Monorepo TypeScript, npm workspaces + Turborepo |
| Licence des données | ODbL-1.0 — © OpenStreetMap contributors (attribution obligatoire) |

### 1.1 Pile technique exacte

```
Node.js          22.23.4
npm              10.9.9
Next.js          15.5.29
React            19.1.0
TypeScript       5.9.3
Tailwind CSS     3.4.17
MapLibre GL      4.7.1
Zustand          5.0.2
TanStack Query   5.62.7
Zod              (contrats partagés)
Fastify          5.6.1
Drizzle ORM      0.44.7
PostgreSQL       17.11  + PostGIS 3.5.2
```

### 1.2 Organisation des dossiers

```
uac-live-3d/
├── apps/
│   ├── web/                      # Front Next.js 15 (App Router) — SEUL front réellement construit
│   │   ├── src/app/              # 6 routes : / /dashboard /map /buildings /buildings/[id] /navigation /reports
│   │   ├── src/components/       # layout/AppShell.tsx, ui/States.tsx, map/CampusMap.tsx
│   │   ├── src/lib/api/          # client.ts (fetch + auth + erreurs), endpoints.ts (contrats Zod)
│   │   ├── src/lib/              # hooks.ts, geo.ts, map-style.ts, offline/, osm-snapshot.ts
│   │   └── src/data/geo/         # 3 fichiers GeoJSON OSM réels (277 Ko au total)
│   └── server/                   # API Fastify
│       └── src/modules/          # buildings, navigation, reports, auth, faculties…
├── packages/
│   ├── contracts/                # Schémas Zod partagés front/serveur
│   ├── database/                 # Drizzle + migrations 0001_init.sql, 0002_osm_geospatial_referential.sql
│   ├── geospatial/               # Graphe piéton, Dijkstra, snapping
│   └── shared/                   # Constantes (DATA_SOURCES, LIMITS…)
├── tools/geo/                    # Scripts Python de projection et d'import OSM
├── src/                          # ⚠️ PROTOTYPE MORT — voir § 8
└── docs/                         # backend-roadmap.md, HANDOFF-claude.md (ce fichier)
```

**Volumétrie** : ~34 660 lignes de TypeScript/Python (hors `node_modules`), 195 fichiers versionnés, 8 fichiers de tests.

### 1.3 Scripts disponibles à la racine

```bash
npm run build            # turbo run build
npm run dev              # turbo run dev
npm run typecheck        # turbo run typecheck
npm run test             # turbo run test
npm run db:migrate       # applique les migrations
npm run db:seed          # peuple la base
```

---

## 2. Les données géographiques réelles (le point fort du projet)

C'est la partie la plus solide et il ne faut **pas** la casser.

### 2.1 Périmètre du campus

| Mesure | Valeur |
|---|---|
| Way OSM du périmètre | `347214829` |
| Superficie | 99,3 hectares |
| Sommets du polygone | 31 à 32 |
| Étendue | 945 m × 1544 m |
| Bâtiments dans le périmètre | **355** (dont 136 nommés) |
| Emprise bâtie totale | 124 697,5 m² |
| Taux de couverture | 12,56 % |
| Cheminements piétons | **117**, total 16,69 km |

### 2.2 Chaîne de projection

Deux référentiels coexistent, volontairement :

1. **Monde local métrique** (`src/data/geo/campus-real.json`) — pour la scène 3D.
   `WGS84 (EPSG:4326)` → `UTM 31N (EPSG:32631)` → repère local métrique.
   **1 unité = 1 mètre. `x` = est, `z` = -nord.** Le nord pointe donc vers -Z,
   ce qui garde la carte 2D et la scène 3D alignées.
   Origine = barycentre pondéré par les aires des emprises.
   `METRES_PER_LEVEL = 3.4`, `DEFAULT_LEVELS = 2`.

2. **Géographique** (`apps/web/src/data/geo/*.geojson`) — pour MapLibre, qui
   projette lui-même. **Ne pas reprojeter** : ce serait une double projection.

Les scripts producteurs sont dans `tools/geo/` :
- `build_web_referential.py` → `campus-real.json` (355 bâtiments, 117 cheminements, 0 ignoré)
- `build_web_osm_geojson.py` → les 3 GeoJSON pour le web
- `audit_campus.py`, `import_osm.py`, `build_study_area.py` → audit et import en base

### 2.3 Provenance et honnêteté des données

- `heightSource` : `osm_height` (18 cas, hauteur réelle OSM) | `osm_levels` | `estimated` (337 cas).
  Une hauteur estimée est **signalée comme telle** dans les données. Ne pas la présenter comme réelle.
- `verificationStatus` : `imported_unverified` / `UNVERIFIED`. Rien n'est « vérifié ».
- 3 bâtiments du référentiel n'ont pas d'emprise OSM et sont marqués `confidence: "unverified"`
  sans coordonnées inventées : `stade`, `infirmerie`, `espace-etudiant`.
- La surface des allées n'est pas publiée par OSM → `surface: null` dans
  `footwaysToEdgeCollection()`. **Ne pas inventer « pavé ».**

**Règle absolue du projet, posée par le commanditaire :**
> « Je préfère une carte 2D exacte et incomplète à une magnifique carte 3D entièrement fictive. »

Corollaires, tous respectés dans le code actuel :
ne fabriquer aucune coordonnée GPS, n'inventer aucun bâtiment, ne dessiner aucune
route arbitraire, ne présenter aucune donnée simulée comme réelle.
Une stade, un parking et un château d'eau avaient été inventés dans la scène 3D :
ils ont été **supprimés** et remplacés par le tracé réel du périmètre OSM.

---

## 3. État réel de la base de données

Base `uac_live`, 18 Mo, **26 tables** (schéma `public`).

| Table | Lignes | Remarque |
|---|---|---|
| `buildings` | **360** | 355 avec `footprint`, 355 avec `centroid` |
| `walkways` | **21** | 21 ont `from_node_id` **et** `to_node_id` renseignés |
| `campus_boundaries` | 2 | |
| `building_code_mapping` | **15** | correspondance `old_code` → `new_building_id`, **jamais lue par le code** (cf. § 4.3) |
| `reports` | 25 | |
| `faculties` | 7 | |
| `rooms` | **0** | vide |
| `users`, `friends`, `notifications`, `study_groups`, `sos_alerts`… | — | présentent, non auditées en détail |

### 3.1 Découverte critique sur le schéma

**Il n'existe aucune colonne `geom`.** Les géométries vivent dans :
- `buildings.footprint` — `geometry(Polygon, 4326)`
- `buildings.centroid` — point
- `walkways.path` — `geometry(LineString, 4326)`

**Il n'existe aucune colonne `is_georeferenced`.** La valeur est calculée à la volée
(cf. bug A § 4.1).

Répartition de `buildings.source` :

```
OSM_IMPORT     355
INSTITUTIONAL    5
```

---

## 4. LES TROIS BUGS BLOQUANTS (à corriger en priorité)

Ces trois défauts font que **l'application ne fonctionne pas aujourd'hui**, malgré
une infrastructure complète. Ils sont indépendants et tous reproductibles.

### 4.1 Bug A — « API injoignable » alors que l'API répond (BLOQUANT ABSOLU)

**Symptôme visible** : sur `/`, `/map` et `/buildings`, le message
« Le chargement a échoué » s'affiche. Sur la page d'accueil, les Facultés
affichent 7 (elles chargent) mais les Bâtiments affichent « API injoignable ».
Cela fait croire à une panne réseau alors que le serveur répond en HTTP 200
en 21 ms.

**Message d'erreur exact affiché dans l'interface :**

```
La réponse de /api/v1/buildings?limit=100 ne respecte pas le contrat attendu :
0.source — Invalid option: expected one of "OSM"|"INSTITUTIONAL"|"STUDENT" ;
1.source — Invalid option: expected one of "OSM"|"INSTITUTIONAL"|"STUDENT" ;
2.source — Invalid option: expected one of "OSM"|"INSTITUTIONAL"|"STUDENT"
```

**Cause racine, mesurée :**

- `packages/shared/src/constants.ts:53` définit :
  ```ts
  export const DATA_SOURCES = ["OSM", "INSTITUTIONAL", "STUDENT"] as const;
  ```
- La base contient `source = 'OSM_IMPORT'` pour **355 bâtiments**.
- `packages/contracts/src/index.ts:169` en déduit `dataSourceSchema = z.enum(DATA_SOURCES)`.
- `apps/web/src/lib/api/endpoints.ts` valide la réponse avec
  `apiFetchValidated<Building[]>('...', z.array(buildingSchema), ...)`.
- Zod rejette donc **les 100 éléments** (100/100 invalides), et comme c'est un
  `z.array(...)`, **un seul échec fait échouer toute la liste**.
- `client.ts` transforme cela en `ApiError('INVALID_RESPONSE', …)`.
- L'UI affiche cet échec comme « API injoignable ».

**Ce n'est donc pas un problème réseau, ni CORS, ni de timeout.**
CORS a été vérifié correct (`access-control-allow-origin: http://localhost:3000`,
preflight `204`). La charge utile fait 69 Ko et répond en 0,02 s.

**Deux corrections possibles (choisir, ne pas faire les deux en aveugle) :**

- *Option 1 — aligner le contrat sur la base* (le plus rapide, mais fige `OSM_IMPORT`) :
  ```ts
  // packages/shared/src/constants.ts
  export const DATA_SOURCES = ["OSM", "OSM_IMPORT", "INSTITUTIONAL", "STUDENT"] as const;
  ```
- *Option 2 — aligner la base sur le contrat* (plus propre sémantiquement) :
  ```sql
  UPDATE buildings SET source = 'OSM' WHERE source = 'OSM_IMPORT';
  ```
  ⚠️ Nécessite de vérifier partout où `'OSM_IMPORT'` est comparé en dur dans le code
  et dans les scripts d'import Python (`tools/geo/import_osm.py`).

**Recommandation** : option 2, avec migration SQL versionnée, car `OSM_IMPORT` est
un nom de *processus* et non une *source*. Mais l'option 1 est acceptable si le
délai est court.

**Effet secondaire à corriger ensuite** : même valides, seuls 100 bâtiments sur 360
seront affichés (bug B).

### 4.2 Bug B — Plafond de pagination silencieux (BLOQUANT)

- `packages/contracts/src/index.ts` : `LIMITS.PAGE_SIZE_MAX = 100`, et une
  validation `.max(100)` sur le paramètre `limit`.
- La carte et la page d'accueil demandent exactement `limit: 100`.
- La base contient **360** bâtiments (355 avec emprise).
- Résultat : **255 bâtiments ne sont jamais affichés**, sans aucun message.
- `limit=200` renvoie `VALIDATION_ERROR`.

De plus, le commentaire dans `apps/web/src/lib/hooks.ts` est **périmé et trompeur** :

```ts
// « limit: 100 couvre tout le campus actuel (15 bâtiments) »
```

Or il y en a 360. Ce commentaire doit être corrigé : il a manifestement été écrit
avant l'import OSM et n'a pas été mis à jour.

**Corrections possibles :**

- *Option 1* — ajouter un endpoint dédié sans pagination, ex.
  `GET /api/v1/buildings/map` renvoyant tous les bâtiments géoréférencés
  (id, code, name, category, centroid, geometry). C'est ce qui avait été
  recommandé dans `docs/backend-roadmap.md`.
- *Option 2* — relever `PAGE_SIZE_MAX` à 500 et passer `limit: 500` côté carte.
  Plus simple, mais charge une réponse inutilement lourde pour la page liste.

**Recommandation** : option 1. Une carte n'a pas de pagination ; une liste si.

### 4.3 Bug C — Le graphe piéton est vide (BLOQUANT pour la navigation)

**Symptôme mesuré :**

```
GET /api/v1/navigation/graph
{ "data": {
    "nodeCount": 355,
    "edgeCount": 0,
    "accessibleEdgeCount": 0,
    "isValidated": false,
    "version": "7488255b"
}}
```

**355 nœuds, 0 arête.** Conséquence : **aucun itinéraire n'est calculable**.
La page `/navigation` ne peut rien produire.

**Cause racine, mesurée.** Dans
`apps/server/src/modules/navigation/navigation.service.ts`, la méthode `getGraph()`
construit les nœuds depuis `buildings.entrance` :

```ts
for (const row of buildingRows) {
  addNode(graph, { id: row.code, type: "ENTRANCE", ... });   // id = buildings.code
}
```

puis filtre les arêtes ainsi (lignes ~108-110) :

```ts
for (const row of walkwayRows) {
  if (!row.fromNodeId || !row.toNodeId) continue;
  if (!graph.nodes.has(row.fromNodeId) || !graph.nodes.has(row.toNodeId)) continue;
  ...
}
```

Or les `walkways.from_node_id` contiennent des **codes courts** qui n'existent pas
dans `buildings.code` :

| Code référencé par `walkways` | Existe dans `buildings.code` ? |
|---|---|
| `ADMIN-SCO` | ✅ 1 |
| `ESPACE-E` | ✅ 1 |
| `FLSH-B` | ✅ 1 |
| `INFIRM` | ✅ 1 |
| `RECTORAT` | ✅ 1 |
| `STADE` | ✅ 1 |
| `IFRI` | ❌ 0 |
| `FAST-A` | ❌ 0 |
| `BIBLIO` | ❌ 0 |
| `CROUS` | ❌ 0 |
| `RESTO-U` | ❌ 0 |
| `AMPHI-500` | ❌ 0 |
| `AMPHI-B` | ❌ 0 |

`buildings.code` contient en réalité des slugs OSM du type `ADMINISTRATION-FAST`,
`AMPHI-A-500`, `BIBLIOTHEQUE-CENTRE-DE-DOCUMENTATION`, `AGRO-MAQUIS`…

**13 codes distincts sont référencés, 6 existent, 7 n'existent pas.** Les 21 allées
sont donc toutes écartées par le `continue`, d'où `edgeCount: 0`.

**La table de correspondance existe déjà — mais elle est INUTILISABLE en l'état.**
C'est le point le plus important de ce document. `building_code_mapping` contient
15 lignes qui font exactement le travail attendu (`old_code` → `new_building_id`),
et elle **n'est jamais lue par `getGraph()`**. On pourrait donc croire le problème
résolu en trois lignes de code. Vérification faite, ce serait une erreur :

**(a) Elle est incomplète.** Sur les 21 allées, la jointure ne résout les **deux**
extrémités que pour **11 allées**. Les 10 autres restent perdues :

```
Résolues (2 extrémités)  : 11
Perdues                  : 10
```

Les 6 lignes en `match_type = 'no_geometry'` (ADMIN-SCO, STADE, FLSH-B, FADESP…)
n'ont **aucun** `new_building_id` : elles documentent honnêtement l'absence
d'empreinte OSM fiable, elles ne fournissent pas de correspondance.

**(b) Elle est géométriquement douteuse.** Les distances de correspondance
(`match_distance_m`) sont énormes :

| Ancien code | Type | Distance |
|---|---|---|
| RESTO-U | name_matched | **780 m** |
| CROUS | name_matched | **755 m** |
| BIBLIO | name_matched | **690 m** |
| FAST-A | name_matched | **681 m** |
| FADESP | name_matched | 581 m |
| RESID-A | name_matched | 576 m |
| AMPHI-500 | name_matched | 549 m |
| IFRI | name_matched | 439 m |
| AMPHI-B | name_matched | 418 m |
| RECTORAT | name_matched | **255 m** |

Une correspondance « appariée par le nom » qui éloigne le point de 255 à 780 m
n'est pas une correspondance : c'est une homonymie probable ou une erreur de
géocodage. **Utiliser cette table telle quelle produirait des itinéraires faux
tout en affichant `edgeCount: 11` — c'est-à-dire un progrès apparent qui
tromperait l'utilisateur.** Le `notes` de la table dit d'ailleurs lui-même :
« empreinte non contrôlée sur le terrain ».

**Corrections possibles, par ordre de fiabilité :**

- *Option 1 (recommandée)* — **reconstruire les nœuds depuis les géométries.**
  Les 21 `walkways.path` sont des `LineString` en 4326 qui portent leurs propres
  extrémités. On extrait les nœuds par découpage des lignes aux intersections
  (ou simplement leurs extrémités), sans dépendre d'aucun code de bâtiment.
  C'est la seule approche qui ne repose sur aucune correspondance devinée.
- *Option 2* — **re-seed des `walkways`** avec les vrais `buildings.code` (slugs
  OSM), en repartant des 117 cheminements OSM réels plutôt que des 21 allées
  déclarées. Plus ambitieux mais donne un vrai réseau.
- *Option 3 (à éviter seule)* — brancher `building_code_mapping` tel quel.
  Donnerait 11 arêtes, dont plusieurs géométriquement fausses.
- *Option 4* — requalifier `walkways.from_node_id` / `to_node_id` en FK vers
  `buildings.code`, et exécuter une migration qui réécrit les valeurs avec les
  slugs réels après vérification manuelle des 13 cas.

**Recommandation** : option 1 pour débloquer, puis option 2 pour un réseau
réellement utilisable. **Ne pas livrer l'option 3 en la présentant comme une
correction : les distances mesurées démontrent qu'elle est fausse.**

**Point d'honnêteté** : même corrigé, le graphe ne sera **pas validé terrain**.
`isValidated: false` et un `disclaimer` doivent rester affichés. Il n'y a que
21 allées déclarées pour 117 cheminements OSM réels : le graphe est incomplet.

---

## 5. Autres défauts identifiés, non bloquants

### 5.1 `isGeoreferenced` mal calculé

`apps/server/modules/buildings/buildings.service.ts:406` :

```ts
isGeoreferenced: row.source === "INSTITUTIONAL" && row.verificationStatus === "VERIFIED",
```

Conséquence mesurée : sur 100 bâtiments renvoyés, **100 ont une géométrie** et
**0 sont marqués `isGeoreferenced: true`**. Le champ devrait refléter la présence
d'une géométrie, pas la provenance. La page `/buildings` a même un filtre
« Géoréférencés » qui, en l'état, ne renvoie jamais rien.

### 5.2 Commentaires de code obsolètes

Plusieurs commentaires affirment des choses fausses (« 15 bâtiments »,
« aucun popup utilisé »). Ils induisent en erreur un nouvel intervenant. À corriger
au passage.

### 5.3 `rooms` vide

La table `rooms` contient 0 ligne, alors que l'endpoint
`GET /api/v1/buildings/:id/rooms` existe et qu'une fiche bâtiment le consomme.
La fiche affichera toujours une liste vide. À décider : alimenter ou masquer.

### 5.4 Prototype mort dans `src/`

Voir § 8. Répertoire présent à la racine, **jamais construit par Turborepo**.
Il utilise Tailwind v4 (`@theme`), R3F, framer-motion — dépendances **présentes
dans `node_modules` mais déclarées dans aucun `package.json`**. Il entre en
collision de routes avec `apps/web` (`/` et `/map`).

### 5.5 Tests insuffisants

8 fichiers de tests seulement pour 34 660 lignes. Aucun test de bout en bout du
contrat API → front. **Un simple test de validation Zod sur une réponse réelle
aurait détecté le bug A avant la mise en ligne.**

---

## 6. Le design : état réel et pistes

Le commanditaire a demandé : « le design, tout doit être parfait ». Voici l'état
factuel, fondé sur des captures d'écran réelles (Chrome headless, 1440×900 et
390×844).

### 6.1 Ce qui est déjà solide

- **Système de couleurs cohérent et documenté** dans `tailwind.config.ts` :
  `bg #070B14`, `surface #111C2E`, `secondary #0D1422`, `primary #35D6F5`,
  `violet #8B5CF6`, `ok #22C55E`, `warn #F59E0B`, `danger #F43F5E`,
  `ink #F8FAFC`, `muted #94A3B8`, `line #1E2B42`. Thème sombre assumé.
- **Rayon personnalisé** `rounded-xl2 = 18px`, utilisés de façon homogène.
- **Coquille responsive** `AppShell.tsx` : barre latérale ≥ `md`, barre
  inférieure à 5 onglets < `md`, tiroir mobile. `h-[100dvh]` (gère la barre
  d'URL mobile), `pb-[env(safe-area-inset-bottom)]` (encoche iPhone).
  Aucun écran n'est « desktop seulement ».
- **Habillage MapLibre** complet dans `globals.css` : contrôles, attribution,
  scrollbars, `.glass`, `.skeleton` avec animation.
- **États de chargement réels** : squelettes, pas de saut de mise en page.
- **Accessibilité de base** : `aria-label` sur les boutons icône,
  `aria-current="page"` sur la navigation, `aria-hidden` sur le décor.
- **Attribution OSM/ODbL affichée** dans l'interface.

### 6.2 Ce qui dessert le design aujourd'hui

**Le plus grave n'est pas esthétique : c'est que les écrans montrent des erreurs.**
Une carte vide avec un encadré rouge d'erreur Zod n'est pas un problème de design,
c'est un problème de données. **Corriger les bugs A/B/C aura plus d'effet visuel
que n'importe quel travail sur les couleurs.**

Pistes esthétiques réelles, une fois les données affichées :

1. **Page d'accueil** — les trois cartes de chiffres sont alignées en grille
   régulière et un peu inertes. Un compteur animé à l'apparition, ou une
   micro-visualisation (barre de couverture, mini-carte), donnerait du relief.
2. **Écran de chargement** — le `subtitle` affiche « Chargement des données… »
   indéfiniment pendant que le corps affiche une erreur. Il faut faire disparaître
   ce texte en cas d'erreur.
3. **Erreurs** — le bloc d'erreur expose le message Zod brut
   (`Invalid option: expected one of "OSM"|…`) au lieu d'un message
   compréhensible. C'est un problème d'UX **et** de confiance.
4. **Carte** — la vue par défaut arrive très dézoomée, montrant des quartiers
   hors campus. Il faut cadrer sur le périmètre UAC réel (`CAMPUS_BOUNDARY`).
5. **Densité d'information** — la carte 3D de `apps/web` utilise déjà
   `fill-extrusion` (`CampusMap.tsx`, lignes 171-184,
   `"fill-extrusion-height": ["*", ["coalesce", ["get","floors"], 1], 3.4]`).
   L'extrusion fonctionne ; c'est le cadrage et la lisibilité qui pèchent.
6. **Typographie** — tout repose sur `Inter`. Une échelle typographique
   explicite (display / title / body / caption) manquerait de hiérarchie.
7. **États vides** — à concevoir : « aucun bâtiment », « aucun signalement »,
   « aucun itinéraire ». Ils n'existent pas encore vraiment.

### 6.3 Deux design systems concurrents

⚠️ **Piège à connaître** : `tailwind.config.ts` (v3.4.17, thème `extend`) et
`src/` (prototype, Tailwind **v4**, syntaxe `@theme`) définissent deux systèmes
incompatibles. Ne pas mélanger. `apps/web` est la référence.

---

## 7. Contrats API et schémas : où regarder

- **Schémas Zod partagés** : `packages/contracts/src/index.ts`
  - `buildingSchema` : ligne 182
  - `polygonGeometrySchema` : ligne 175 — **chaque anneau doit avoir ≥ 4 points**,
    coordonnées `[lng, lat]` bornées à ±180 / ±90
  - `dataSourceSchema` : ligne 169 → **source du bug A**
  - `buildingCategorySchema` : ligne 167
    → `ACADEMIC, ADMINISTRATIVE, AMPHITHEATER, LIBRARY, FOOD, RESIDENCE, SPORTS, SERVICE, OTHER`
- **Constantes** : `packages/shared/src/constants.ts`
  - `DATA_SOURCES` ligne 53 → **source du bug A**
- **Client HTTP** : `apps/web/src/lib/api/client.ts`
  - `API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`
  - `apiFetchValidated()` — jette `ApiError('INVALID_RESPONSE')` si le schéma échoue
- **Endpoints front** : `apps/web/src/lib/api/endpoints.ts`
  - `fetchBuildings()` — `z.array(buildingSchema)` → **amplifie le bug A**
  - `fetchFaculties()` — fonctionne (facultySchema valide)

Enveloppe de réponse attendue par le front :
```json
{ "data": …, "meta": { "page", "limit", "total", "totalPages", "hasMore" }, "requestId": "…" }
```

Enveloppe d'erreur :
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "requestId": "…", "fields": {} } }
```

---

## 8. Le prototype de `src/` : conclusion définitive

**Il est mort. Ne pas l'intégrer.** Justification mesurée :

1. Turborepo ne construit que `apps/*` et `packages/*` (`turbo.json`, workspaces).
   `src/` n'est dans aucun workspace.
2. Le `package.json` racine **n'a aucune dépendance** — seulement des scripts turbo.
3. `src/` utilise Tailwind **v4** (`@theme`) alors que `apps/web` est en **v3.4.17**.
4. Ses dépendances (R3F 9.8.x, drei 10.x, three 0.180, framer-motion) sont dans
   `node_modules` mais **déclarées nulle part** → build non reproductible.
5. Il **entre en collision de routes** avec `apps/web` : `/` et `/map` existent
   dans les deux.
6. Il n'a **aucun test**.
7. Il n'apporte pas la 3D : `apps/web` fait déjà de l'extrusion 3D via MapLibre.

Si le commanditaire veut un jour s'en servir, ce doit être un **portage sélectif
de composants**, pas une intégration de l'arborescence.

---

## 9. Environnement de développement validé

### 9.1 Démarrage (procédure qui fonctionne)

```bash
# 1. Dépendances
npm install

# 2. Base de données (PostgreSQL 17 + PostGIS 3.5 doivent tourner)
export PGPASSWORD=postgres
psql -h localhost -U postgres -d uac_live -c "SELECT postgis_version();"

# 3. Migrations + seed
npm run db:migrate
npm run db:seed

# 4. API (port 4000)
cd apps/server && npm run dev

# 5. Front (port 3000)
cd apps/web && npm run dev        # ou : npm run build && npm start
```

Variables d'environnement de l'API (`apps/server/.env`) :
```
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uac_live
```

Le front lit `NEXT_PUBLIC_API_URL` (défaut `http://localhost:4000`).
**Aucun fichier `.env` n'existe pour `apps/web`** — c'est pourquoi le défaut s'applique.

### 9.2 État vérifié

| Contrôle | Résultat |
|---|---|
| `GET /health` | `{"status":"ok","database":"up","postgis":"3.5","uptimeSeconds":40891}` |
| `GET /api/v1/faculties` | HTTP 200, 7 entrées valides |
| `GET /api/v1/buildings?limit=100` | HTTP 200, **100 items, mais rejetés par Zod** |
| `GET /api/v1/navigation/graph` | HTTP 200, **355 nœuds / 0 arête** |
| `npm run build` | ✅ succès, 6 tâches, 36,6 s |
| `cd apps/web && npx tsc --noEmit` | ✅ **0 erreur** |
| `npx tsc --noEmit` (racine) | ⚠️ 96 erreurs, **toutes sous `apps/`**, 0 sous `src/` — préexistantes |
| CORS | ✅ `access-control-allow-origin: http://localhost:3000`, preflight 204 |

**Non vérifié** : fonctionnement de l'API après correction des bugs ; tests
d'intégration complets ; comportement hors ligne (cache IndexedDB annoncé dans
le code mais non exercé).

---

## 10. Plan d'action recommandé, par ordre d'impact

### Phase 1 — Rendre l'application fonctionnelle (½ à 1 journée)

1. **Corriger le bug A** (contrat `DATA_SOURCES`). Effet : les 100 bâtiments
   s'affichent, les trois écrans principaux cessent d'afficher une erreur.
   → Vérifier ensuite quels autres enums divergent entre base et contrat
   (`reports.status`, `reports.category` — cf. § 11).
2. **Corriger le bug B** (pagination). Effet : 355 bâtiments au lieu de 100.
3. **Corriger les commentaires obsolètes** (« 15 bâtiments »).
4. **Écrire un test de contrat** : appeler chaque endpoint réel et valider la
   réponse contre le schéma Zod. C'est le garde-fou qui manquait.

**Critère d'acceptation** : `/`, `/map`, `/buildings` affichent des données
réelles sans message d'erreur ; le nombre de bâtiments affichés est 355.

### Phase 2 — Rendre la navigation utilisable (1 à 2 jours)

5. **Corriger le bug C** (graphe vide). **Ne pas se contenter de brancher
   `building_code_mapping`** : elle ne couvre que 11 arêtes sur 21 et ses
   distances de correspondance (255 à 780 m) montrent qu'elle est peu fiable.
   Reconstruire les nœuds depuis les `LineString` de `walkways.path`.
6. **Étendre le réseau** : 21 allées déclarées pour 117 cheminements OSM réels.
   Importer les 117 pour obtenir un graphe réellement utilisable.
7. **Conserver `isValidated: false`** et le disclaimer tant qu'aucun relevé
   terrain n'a été fait. C'est une exigence explicite du commanditaire.

**Critère d'acceptation** : un itinéraire entre deux bâtiments réels renvoie un
tracé non nul **dont la longueur est cohérente avec la distance à vol d'oiseau**
(rapport < 1,6). Un `edgeCount` non nul ne suffit pas comme critère de succès :
il peut être atteint avec des arêtes fausses.

### Phase 3 — Design et finition (2 à 3 jours)

8. **Corriger les messages d'erreur** : ne jamais exposer un message Zod brut.
9. **Cadrer la carte** sur le périmètre UAC réel au chargement (`CAMPUS_BOUNDARY`).
10. **Concevoir les états vides** (aucun bâtiment, aucun signalement, aucun itinéraire).
11. **Hiérarchie typographique** explicite.
12. **Animer les compteurs** de la page d'accueil (avec `prefers-reduced-motion`).
13. **Vérifier sur appareil réel** — les captures headless ne remplacent pas un test tactile.

### Phase 4 — Consolidation (optionnel)

14. Alimenter ou masquer `rooms`.
15. Décider du sort de `src/` (supprimer ou archiver explicitement).
16. Réduire les 96 erreurs de typecheck sous `apps/`.
17. Documentation ADR.

---

## 11. Pièges à éviter (leçons de l'audit)

1. **Ne pas conclure « API injoignable » depuis un message UI.** Vérifier
   `curl` **et** la validation côté client. Ici l'API allait très bien.
2. **Ne pas se fier à un commentaire de code.** « 15 bâtiments » était faux (360).
3. **Un `z.array(schema)` échoue globalement.** Un seul élément invalide fait
   disparaître toute la liste. Envisager de valider élément par élément et de
   signaler les rebuts au lieu de tout rejeter.
4. **Vérifier TOUS les enums** entre base et contrat avant de conclure. État mesuré :
   - `buildings.source` : base `OSM_IMPORT` / contrat `OSM` → ❌ **divergent (bug A)**
   - `reports.status` : base `ACTIVE, CONFIRMED, RESOLVED, REJECTED` ⊂ contrat
     `ACTIVE, CONFIRMED, RESOLVED, EXPIRED, REJECTED` → ✅ **compatible**
   - `reports.category` : base `OTHER, EVENT, LOST_ITEM, ACCESSIBILITY, CROWD,
     CLEANLINESS, SAFETY, MAINTENANCE` / contrat identique → ✅ **aligné**
   → Conclusion : **seul `buildings.source` diverge.** Ne pas « corriger » les
   autres à l'aveugle. Un script de comparaison automatisée base ↔ contrat
   serait le vrai garde-fou à écrire.
5. **Ne pas reprojeter les GeoJSON web.** MapLibre projette lui-même.
6. **Ne pas inventer de hauteur, de surface, de coordonnée.** Signaler
   `estimated`, `null`, `unverified` — c'est déjà fait, ne pas régresser.
7. **Ne pas présenter une capture d'écran blanche ou une erreur comme une preuve
   de succès.** Le commanditaire a explicitement demandé de ne pas le faire.
8. **`buildings.code` ne contient pas les codes courts** (`IFRI`, `FAST-A`…).
   Toute nouvelle jointure doit en tenir compte.

---

## 12. Règles de collaboration posées par le commanditaire

Ces contraintes sont **impératives** et ont été respectées jusqu'ici :

- Ne pas pousser vers un dépôt auquel le compte authentifié n'a pas accès.
- Ne pas changer les remotes sans autorisation.
- **Aucun force push.** Jamais de réécriture d'historique.
- Ne pas détruire les travaux précédents ni supprimer les fonctionnalités validées.
- Ne fabriquer aucune coordonnée GPS, n'inventer aucun bâtiment, ne dessiner
  aucune route arbitraire.
- Ne présenter aucune donnée simulée comme réelle.
- Ne pas considérer une capture d'écran blanche comme une preuve.
- Préférer une carte 2D exacte et incomplète à une carte 3D magnifique et fictive.
- Répondre en **français**.

---

## 13. Ce qui a été fait dans la dernière session (traçabilité)

Commits présents sur GitHub (`main`, HEAD `ced3041`) :

```
ced3041  docs: feuille de route backend issue d'un audit exécuté
8472206  feat(geo): intégrer les emprises OSM réelles et le routage piéton réel
2a39a94  feat(geo): référentiel géospatial OSM réel et inventaire du périmètre d'étude
9e7370a  fix(web): recherche et fiche de détail utilisables sur mobile
f0de322  test(web,server): valider itinéraire hors ligne, cache IndexedDB et contrat
558794c  feat(web): premier frontend Next.js connecté au backend réel
```

Réalisé :

- Pipeline de projection WGS84 → UTM 31N → repère local métrique (355 bâtiments,
  117 cheminements, 0 ignoré).
- 11 bâtiments du référentiel positionnés sur leurs vraies coordonnées OSM avec
  provenance (`osmId`) ; 3 sans emprise marqués `unverified` sans invention.
- Carte 2D : vrais polygones OSM au lieu de rectangles.
- Scène 3D : extrusion des vrais anneaux OSM (`GeoCity.tsx`), géométries
  fusionnées par catégorie (5 draw calls au lieu de 344).
- Routage : Dijkstra sur le graphe OSM réel (464 nœuds, 515 arêtes, 3 composantes
  de 445/15/4) — **côté client** ; le graphe **serveur** est celui qui est vide.
- Suppression du stade, du parking et du château d'eau inventés ;
  remplacement par le tracé réel du périmètre OSM.
- Instantané OSM de secours pour `apps/web` (`osm-snapshot.ts`).
- Fichiers de données : `uac-osm-buildings.geojson` (229 Ko),
  `uac-osm-footways.geojson` (44 Ko), `uac-osm-meta.json` (3,3 Ko).
- `docs/backend-roadmap.md` : feuille de route backend (352 lignes).
- Correction de `.gitignore` : la règle `out/` excluait silencieusement tous les
  rapports d'audit géospatial ; devenue `/out/` + `apps/*/out/`. Ajout de `core.*`.

⚠️ **Écart connu et assumé** : il existe un routage Dijkstra **client**
(`src/lib/routing.ts`, avec les 117 cheminements OSM) et un graphe **serveur**
vide. Ces deux implémentations coexistent. Il faut décider laquelle fait
autorité avant d'aller plus loin — c'est peut-être la source la plus rapide de
solution pour le bug C.

---

## 14. Points ouverts à trancher par le commanditaire

1. `buildings.source` : renommer la base en `OSM`, ou élargir le contrat ?
2. Carte : endpoint `/buildings/map` sans pagination, ou relever le plafond ?
3. Graphe piéton : reconstruire les nœuds depuis les `LineString` (recommandé),
   ou corriger `building_code_mapping` après vérification des 13 codes ?
   ⚠️ La table existante ne couvre que 11 allées sur 21, avec des écarts de
   255 à 780 m : elle ne peut pas être utilisée sans contrôle.
4. Importer les 117 cheminements OSM en base, ou reconstruire les nœuds ?
5. Le routage fait autorité côté client ou côté serveur ?
6. `rooms` : alimenter ou masquer ?
7. `src/` : supprimer ou archiver ?
8. Une image de « récépissé de demande de rendez-vous CHUD-OP Porto-Novo » a été
   transmise sans explication lors d'un échange. **Aucune action n'a été prise.**
   Confirmer si elle est liée au projet (elle ne semble pas l'être).

---

## 15. Fichiers à lire en premier

| Fichier | Pourquoi |
|---|---|
| `packages/shared/src/constants.ts:53` | Bug A — `DATA_SOURCES` |
| `packages/contracts/src/index.ts:167-204` | Schémas bâtiment, enums |
| `apps/web/src/lib/api/endpoints.ts` | Où la validation échoue |
| `apps/web/src/lib/api/client.ts` | `apiFetchValidated`, gestion d'erreurs |
| `apps/server/src/modules/navigation/navigation.service.ts:63-130` | Bug C — `getGraph()` |
| `apps/server/src/modules/buildings/buildings.service.ts:406` | `isGeoreferenced` |
| `apps/web/src/lib/hooks.ts:54-68` | Commentaire « 15 bâtiments » faux |
| `apps/web/src/components/layout/AppShell.tsx` | Coquille responsive de référence |
| `apps/web/tailwind.config.ts` | Palette imposée, valeurs exactes |
| `apps/web/src/components/map/CampusMap.tsx:171-184` | Extrusion 3D déjà en place |
| `docs/backend-roadmap.md` | Analyse backend complémentaire |
| `tools/geo/build_web_referential.py` | Projection, référence de la chaîne géo |

---

**Fin du document.** Toute affirmation ci-dessus a été produite par une commande
exécutée pendant l'audit. Si un doute subsiste sur un point, le rejouer plutôt
que le supposer.
