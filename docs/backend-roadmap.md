# Comment créer le backend complet — UAC-Live 3D

> Document rédigé après audit du dépôt le 24 novembre 2026.
> Chaque affirmation ci-dessous a été vérifiée par commande, pas supposée.

---

## Avertissement préalable : le backend existe déjà

Une version antérieure de mon analyse affirmait que le backend restait à construire,
qu'il fallait « installer PostgreSQL » et que `apps/web` n'affichait qu'un instantané
statique. **C'était faux.** L'audit du dépôt le démontre :

| Élément | Réalité vérifiée |
|---|---|
| PostgreSQL | **17.11 installé**, cluster `main` **en ligne** sur le port 5432 |
| PostGIS | **3.5.2 installé** et actif (`postgis: "3.5"` dans `/health`) |
| Base de données | `uac_live`, **18 Mo**, **28 tables** créées |
| Migrations | `0001_init.sql` et `0002_osm_geospatial_referential.sql` **appliquées** |
| API Fastify | **En cours d'exécution** sur `:4000`, `database: "up"` |
| Endpoints | **33 routes** déclarées sous `/api/v1/` |
| Services | **7 services**, **0 stub** (buildings 477 l., identity 362 l., navigation 376 l., presence 283 l., reports 352 l., notifications 133 l., sos 204 l.) |
| Tests | 2 fichiers (`00-smoke.test.ts`, `10-api.test.ts`) + 2 tests frontend |
| Données | **360 bâtiments** (355 avec emprise), **25 signalements**, **25 utilisateurs**, **10 groupes d'étude**, 2 frontières |

**Le vrai travail n'est donc pas de créer le backend : il est de le rendre
cohérent, complet et observable.** Ce document décrit ce chemin.

---

## Ce qui rendrait vraiment le produit meilleur

Par ordre d'impact décroissant, avec l'écart mesuré entre l'état actuel et l'état cible.

### 1. Corriger les défauts qui empêchent la carte d'exploiter la base — *impact maximal*

C'est le seul point qui transforme réellement le produit : aujourd'hui la carte
n'utilise pas la base, alors que la base contient tout.

#### Défaut A — `isGeoreferenced` est calculé à l'envers

```ts
// apps/server/src/modules/buildings/buildings.service.ts:406
isGeoreferenced: row.source === "INSTITUTIONAL" && row.verificationStatus === "VERIFIED",
```

Cette expression ne teste **pas** la présence d'une géométrie. Elle exige
simultanément une source `INSTITUTIONAL` et une vérification `VERIFIED`.

Mesures sur la base réelle :

```
total batiments            : 360
avec footprint (emprise)   : 355
avec centroid              : 355
source = OSM_IMPORT        : 355
verification = UNVERIFIED  : 360
=> isGeoreferenced = true  : 0
```

**Conséquence** : les 355 emprises réelles sont marquées « non géoréférencées ».
Toute interface qui se fie à ce drapeau pour décider d'afficher un polygone
considère le campus comme vide.

**Correction attendue** : la géoréférence est une propriété de la géométrie, pas
de la source ni du niveau de vérification.

```ts
isGeoreferenced: geometry !== null && geometry !== undefined,
```

Cela sépare proprement deux notions aujourd'hui confondues :
- **est géoréférencé** → possède une emprise ou un centroïde en WGS84 ;
- **est vérifié** → `verificationStatus === "VERIFIED"` (relevé terrain).

#### Défaut B — plafond de pagination trop bas pour une carte

`LIMITS.PAGE_SIZE_MAX = 100` (`packages/contracts/src/index.ts:52`) et
`apps/web/src/app/map/page.tsx:48` demande exactement `limit: 100`.

Mesures :

```
limit=100 -> 100 items  (frontière exacte)
limit=200 -> VALIDATION_ERROR
```

**Conséquence** : 100 bâtiments sur 360 sont affichés. 260 emprises réelles
n'apparaissent jamais sur la carte. Aucune erreur visible pour l'utilisateur —
c'est le pire type de défaut : silencieux et plausible.

**Correction attendue**, au choix :
1. ajouter un endpoint dédié `GET /api/v1/buildings/map` sans pagination mais avec
   simplification géométrique (`ST_Simplify`) côté PostGIS — la bonne option ;
2. ou relever `PAGE_SIZE_MAX` à 500 pour cette route, en assumant la charge.

L'option 1 est préférable : elle garde la pagination honnête pour les listes et
sert la carte avec une géométrie allégée, adaptée au zoom.

#### Défaut C — incohérence d'enveloppe de réponse

L'API renvoie `{ data: [...] }` ; mes premiers scripts de contrôle lisaient
`items` et concluaient « 0 bâtiment ». Ce n'est pas un bug du serveur, mais cela
révèle un risque : aucune vérification automatisée ne valide aujourd'hui la forme
des réponses de bout en bout. À couvrir par un test de contrat.

**Ce que ce point apporte** : la carte passe de 100 à 355 emprises, et le drapeau
de géoréférence redevient utilisable. C'est le gain visible le plus fort.

---

### 2. Consolider le backend existant — *impact élevé, effort modéré*

Les 33 routes et 7 services existent, mais l'audit révèle des angles morts.

#### 2.1 Couverture de tests insuffisante

Deux fichiers de tests pour 33 endpoints. Recommandation : un test par endpoint
critique, en priorité :

| Priorité | Endpoints | Ce qu'il faut prouver |
|---|---|---|
| Haute | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | rotation du refresh token, révocation, expiration |
| Haute | `GET /buildings`, `/buildings/:id`, `/buildings/:id/rooms` | enveloppe `{data,meta}`, pagination, cohérence `isGeoreferenced` |
| Haute | `POST /reports`, `/reports/:id/vote`, `/reports/:id/resolve` | vote unique par utilisateur, transition de statut, idempotence |
| Moyenne | `POST /navigation/routes` | itinéraire sur le graphe PostGIS, distance mesurée |
| Moyenne | `PATCH /presence/privacy`, `/presence/status` | application de la politique de confidentialité (`privacy.policy.ts`) |
| Basse | `/admin/*` | contrôle d'accès par rôle |

#### 2.2 Politique de confidentialité à éprouver

`presence/privacy.policy.ts` existe et gère quatre modes, mais aucun test ne
vérifie qu'un étudiant en mode `ghost` disparaît réellement de `/presence/nearby`.
C'est une exigence de sûreté, pas un détail : une fuite de localisation est un
incident grave.

#### 2.3 Le SOS doit rester explicitement une simulation

`POST /api/v1/sos` existe. Il ne doit **jamais** transmettre vers un service
d'urgence réel sans validation juridique et convention hospitalière. Recommandation :
que la route renvoie un champ `simulated: true` explicite et que le service refuse
toute configuration d'envoi réel tant que ce n'est pas décidé.

#### 2.4 Ce qu'il faut ajouter

Rien de structurel : le socle est bon. Manquent surtout :
- **rate limiting** sur `/auth/*` et `/reports` (protection anti-abus) ;
- **idempotency keys** sur les créations sensibles ;
- **observabilité** : journalisation structurée corrélée au `requestId` déjà présent.

---

### 3. Accessibilité, internationalisation, tests — *ce qui distingue une démo d'un produit*

Moins spectaculaire, mais c'est ici que se joue la crédibilité.

| Axe | État | Cible |
|---|---|---|
| Accessibilité | Non auditée | Navigation clavier complète, `aria-label` sur la carte, contraste AA, alternatives textuelles aux calques |
| i18n | Français en dur | `next-intl` ou équivalent, français + anglais au minimum (campus international) |
| Tests frontend | 2 fichiers (`graph-cache`, `graph-route`) | Composants critiques, parcours carte → fiche → itinéraire |
| Performance | Non mesurée | Budget : première peinture de la carte < 2 s en 4G |
| PWA / hors ligne | Non vérifiée | Le cache IndexedDB existe (`offline/graph-cache.ts`) — le tester réellement |

---

## Procédure de mise en route — validée par exécution

Chaque commande ci-dessous a été exécutée avec succès sur ce sandbox.

### Étape 1 — Vérifier PostgreSQL et PostGIS

```bash
pg_lsclusters
# Résultat attendu :
# 17  main  5432  online  postgres  /var/lib/postgresql/17/main  ...
```

Si le statut n'est pas `online` :

```bash
sudo pg_ctlcluster 17 main start
```

Vérifier PostGIS :

```bash
sudo -u postgres psql -tAc \
  "SELECT name, default_version FROM pg_available_extensions WHERE name='postgis';"
# postgis|3.5.2
```

### Étape 2 — Vérifier la base et son contenu

```bash
sudo -u postgres psql -tAc \
  "SELECT datname FROM pg_database WHERE datistemplate=false;"
# postgres
# uac_live

sudo -u postgres psql -d uac_live -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
# 28

sudo -u postgres psql -d uac_live -tAc "
SELECT count(*) AS total,
       count(*) FILTER (WHERE footprint IS NOT NULL)  AS avec_emprise,
       count(*) FILTER (WHERE centroid  IS NOT NULL)  AS avec_centroide
FROM buildings;"
# 360|355|355
```

> **Piège identifié** : la table `buildings` n'a **pas** de colonne
> `is_georeferenced` ni `geom`. Les géométries vivent dans `footprint`
> (type `geometry`) et `centroid` (type `geography`). Interroger `geom`
> renvoie `ERROR: column "geom" does not exist`.

### Étape 3 — Configurer le serveur

Le fichier `apps/server/.env` doit contenir au minimum :

```env
NODE_ENV=development
PORT=4000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uac_live
```

Pour un environnement réel, ne pas réutiliser le mot de passe `postgres`.
Générer les secrets :

```bash
openssl rand -base64 48   # exécuter trois fois : JWT, refresh, sel IP
```

### Étape 4 — Appliquer migrations et données d'amorçage

```bash
cd /home/user/uac-live-3d
pnpm db:migrate     # exécute packages/database/src/migrate.ts
pnpm db:seed        # exécute packages/database/src/seed/run.ts
```

### Étape 5 — Démarrer l'API

```bash
cd /home/user/uac-live-3d
pnpm --filter @uac/server dev
```

Vérification :

```bash
curl -s http://localhost:4000/health
# {"status":"ok","service":"uac-live-3d-api","version":"1.0.0",
#  "database":"up","postgis":"3.5", ...}
```

### Étape 6 — Démarrer le frontend

```bash
cd /home/user/uac-live-3d
pnpm --filter @uac/web dev
```

L'API est attendue sur `http://localhost:4000`
(`apps/web/src/lib/api/client.ts:18`, variable `NEXT_PUBLIC_API_URL`).

### Étape 7 — Vérifier que la carte consomme bien la base

```bash
# 1. Le serveur répond
curl -s http://localhost:4000/api/v1/buildings?limit=3 | head -c 200

# 2. Compter ce que la carte peut réellement afficher aujourd'hui
curl -s "http://localhost:4000/api/v1/buildings?limit=100" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']), 'batiments')"
# 100  <- plafond : 260 emprises invisibles (voir Défaut B)

# 3. Mesurer l'impact du Défaut A
curl -s "http://localhost:4000/api/v1/buildings?limit=100" | python3 -c "
import sys,json
items=json.load(sys.stdin)['data']
print('geometries      :', sum(1 for b in items if b.get('geometry')))
print('isGeoreferenced :', sum(1 for b in items if b.get('isGeoreferenced')))
"
# geometries      : 100
# isGeoreferenced : 0     <- incohérence à corriger
```

---

## Plan d'exécution recommandé

### Phase 1 — Rendre la carte exacte (1 à 2 jours)

1. Corriger `isGeoreferenced` → testé par un cas : un bâtiment OSM avec emprise
   doit ressortir `isGeoreferenced: true`.
2. Créer `GET /api/v1/buildings/map` : toutes les emprises, géométrie simplifiée,
   sans pagination.
3. Brancher `apps/web/src/app/map/page.tsx` sur cette route.
4. Critère d'acceptation : **355 emprises affichées**, vérifié par capture d'écran
   et par comptage des features envoyées à MapLibre.

### Phase 2 — Rendre le backend fiable (3 à 5 jours)

5. Tests d'intégration sur les 12 endpoints prioritaires.
6. Test explicite de la politique de confidentialité (mode `ghost`).
7. Rate limiting sur `/auth/*` et `/reports`.
8. Critère : suite de tests verte, aucun endpoint prioritaire sans test.

### Phase 3 — Rendre le produit présentable (1 à 2 semaines)

9. Audit d'accessibilité (clavier, contraste, lecteur d'écran).
10. i18n français / anglais.
11. Mesure de performance et budget.
12. Test réel du mode hors ligne (IndexedDB).

---

## Ce qu'il ne faut pas faire

- **Ne pas réinstaller PostgreSQL.** Il est présent et fonctionne. Toute
  réinstallation risque de détruire les 360 bâtiments importés.
- **Ne pas réinitialiser la base** sans sauvegarde préalable :
  `pg_dump uac_live > backup.sql`.
- **Ne pas inventer de géométrie** pour les 5 bâtiments sans emprise. Ils doivent
  rester affichés comme points (via `centroid`) ou pas du tout — jamais comme
  polygones fabriqués.
- **Ne pas activer l'envoi réel du SOS** sans cadre juridique et convention
  hospitalière explicite.
- **Ne pas présenter `imported_unverified` comme vérifié.** Les 355 emprises sont
  réelles (OpenStreetMap, ODbL) mais aucune n'a été contrôlée sur le terrain.

---

## Résumé honnête

| Question | Réponse |
|---|---|
| Le backend est-il à créer ? | **Non.** 33 endpoints, 7 services, 28 tables, 0 stub. |
| Fonctionne-t-il ? | **Oui.** L'API répond, la base est peuplée, PostGIS est actif. |
| Pourquoi la carte semble-t-elle vide ? | **Deux bugs** : `isGeoreferenced` calculé à l'envers, et un plafond de 100 sur 360 bâtiments. |
| Quel est le gain le plus rapide ? | **Phase 1** (1–2 jours) : la carte passe de 100 à 355 emprises réelles. |
| Que reste-t-il de vraiment long ? | Accessibilité, i18n, couverture de tests — c'est ce qui sépare une démo d'un produit. |
| Ce document est-il fiable ? | Chaque chiffre a été produit par une commande exécutée sur ce sandbox le 24/11/2026. |

---

*Sources géographiques : © OpenStreetMap contributors, licence ODbL-1.0.
Les données sont réelles mais non vérifiées sur le terrain — statut
`imported_unverified` / `UNVERIFIED` conservé partout.*
