# UAC-LIVE 3D — Campus Map & Social Radar

> Jumeau numérique social de l'Université d'Abomey-Calavi (Bénin).
> Prototype frontend complet · **données simulées** · projet d'**Eucher ABATTI**.

Une application web premium qui combine une carte 3D procédurale du campus (centrée sur l'IFRI),
un radar de présence étudiante, des alertes communautaires, une navigation piétonne simulée et
des contrôles de confidentialité.

---

## 1. Démarrage rapide

```bash
# Installation
npm install

# Développement (http://localhost:3000)
npm run dev

# Production
npm run build
npm start

# Vérification des types
npm run typecheck
```

Aucune variable d'environnement, aucun backend, aucune clé API n'est nécessaire.
Toutes les données proviennent de `src/data/` et l'état persiste dans `localStorage`.

---

## 2. Compte de démonstration

L'authentification est **entièrement simulée côté client** :

- Identifiant : `UAC2024177` (ou n'importe quel email)
- Mot de passe : n'importe quelle valeur ≥ 4 caractères

`/register` crée un profil local, `/onboarding` fait choisir un avatar, un mode de
confidentialité (Fantôme par défaut) puis présente les fonctionnalités.

---

## 3. Routes

| Route | Description |
|---|---|
| `/` | Redirection intelligente (session → `/map`, sinon `/login`) |
| `/login` | Connexion simulée, toggle email / matricule, affichage du mot de passe |
| `/register` | Formulaire validé (React Hook Form + Zod), faculté → départements liés |
| `/forgot-password` | Flux de réinitialisation simulé avec confirmation |
| `/onboarding` | 3 étapes : avatar, confidentialité, découverte |
| `/map` | **Écran principal** — carte 3D/2D, radar, recherche, panneau d'activité |
| `/alerts` | Radar communautaire : filtres, création, confirmation, signalement, commentaires |
| `/study` | Groupes d'étude : rejoindre/quitter, filtres, création |
| `/friends` | Amis, demandes, découverte, profils |
| `/notifications` | Boîte de réception typée, lu/non lu, filtres |
| `/profile` | Profil éditable, contributions, réputation, confidentialité |
| `/settings` | Compte, confidentialité, notifications, apparence, carte, données, a11y |

---

## 4. Architecture

```
uac-live-3d/
├── src/
│   ├── app/
│   │   ├── (auth)/            # login, register, forgot-password, onboarding
│   │   ├── (app)/             # coquille authentifiée (AppShell)
│   │   │   ├── map/           # tableau de bord cartographique
│   │   │   ├── alerts/ study/ friends/ notifications/ profile/ settings/
│   │   │   └── layout.tsx
│   │   ├── layout.tsx         # fonts, metadata, PWA manifest
│   │   ├── providers.tsx      # thème / mouvement réduit / horloge de démo
│   │   └── page.tsx           # route d'entrée
│   ├── components/
│   │   ├── auth/              # AuthShell (narration de marque + carte formulaire)
│   │   ├── buildings/         # BuildingDrawer + StudentProfileModal
│   │   ├── campus-3d/         # Campus3D, CampusBuilding, CampusEnvironment, CameraRig
│   │   ├── layout/            # AppShell, Sidebar, MobileTabBar, SearchBar
│   │   ├── map/               # CampusMap2D, MapControls, ActivityPanel
│   │   └── ui/                # primitives, Toaster, Tooltip
│   ├── data/                  # buildings, students, alerts, social (mock centralisé)
│   ├── lib/                   # routing (graphe piéton), utils
│   ├── store/                 # useAppStore (Zustand + persist)
│   ├── styles/globals.css     # design system (Tailwind v4 @theme + tokens CSS)
│   └── types/                 # modèles TypeScript stricts
├── public/                    # manifest.webmanifest, icon.svg
└── next.config.ts / tsconfig.json / postcss.config.mjs
```

**Choix techniques**

- **Next.js 15.5 (App Router) + React 19 + TypeScript strict** — routes statiques, code splitting.
- **React Three Fiber + drei + three** — scène 3D procédurale réellement interactive.
- **Zustand v5 + persist** — état partagé + persistance `localStorage` (clé `uac-live-3d:v1`).
  ⚠️ Les sélecteurs dérivés utilisent `useShallow` (obligatoire en v5 pour éviter les boucles de rendu).
- **Tailwind CSS v4** — design system via `@theme` + variables CSS (`--bg-panel`, `--accent`…).
- **Framer Motion** — transitions de panneaux, toasts, modales.
- **React Hook Form + Zod** — validation des formulaires d'inscription/connexion.
- **lucide-react** — iconographie.

---

## 5. La scène 3D

- 14 bâtiments procéduraux (volume, toit, trim lumineux, fenêtres générées, auvent, beacon d'alerte).
- 3 niveaux de qualité (`low` / `medium` / `high`) qui pilotent le nombre d'arbres, de fenêtres,
  les ombres et le `dpr`.
- `OrbitControls` + **rig caméra à interpolation amortie** (fly-to cinématique) lors d'une sélection.
- Éclairage jour/nuit (`directionalLight` + lampadaires ponctuels + brume).
- **Route piétonne** rendue en tube + ligne dashing animée.
- Avatars étudiants 3D cliquables (couleur = statut d'activité).
- **Repli 2D** : sonde WebGL → `CampusMap2D` (SVG vectoriel pan/zoom, pins d'alerte,
  avatars, itinéraire) — ce n'est pas une capture d'écran mais un rendu vectoriel complet.

### Transparence sur la géométrie

Les coordonnées de `src/data/buildings.ts` sont des **coordonnées de démonstration** placées à la
main dans une grille métrique locale. Ce ne sont **pas** des positions géoréférencées et elles ne
doivent pas être présentées comme telles. La conversion vers OpenStreetMap / GPS réels est listée
dans les prochaines étapes.

---

## 6. Données simulées (`src/data/`)

| Jeu | Volume |
|---|---|
| Bâtiments / POI | 14 |
| Profils étudiants | 25 (dont 10 amis) |
| Avatars sur le radar | 18 (les modes Fantôme sont exclus) |
| Alertes campus | 14 (8 catégories) |
| Groupes d'étude | 10 |
| Notifications | 12 |
| Demandes d'amis | 2 |

Tout est identifié comme simulé dans l'interface (bandeaux, pieds de page, mentions).

---

## 7. Interactions implémentées

- Barre latérale → navigation entre tous les modules ; badges dynamiques.
- Recherche globale (`Ctrl/⌘ + K`) sur bâtiments, salles, équipements et étudiants → fly-to.
- Sélection d'un bâtiment (clic 3D **ou** 2D **ou** recherche) → drawer à onglets
  (aperçu, salles, alertes) avec occupation, équipements, présence.
- Avatar étudiant → modale profil (statut, amis communs, réputation, demande de connexion).
- Contrôles carte : zoom, me localiser, recentrer, navigation, 2D/3D, jour/nuit, calques.
- Sélecteur de confidentialité (4 modes) → mise à jour immédiate + toast.
- Navigation : calcul d'itinéraire, distance, durée, instructions pas à pas, recentrage, annulation.
- Alertes : création, confirmation, signalement (résolution auto à 3), commentaires, filtres,
  tri (récence / confirmations / proximité), expiration automatique simulée.
- Groupes : création, rejoindre/quitter avec mise à jour des places et du statut.
- Amis : accepter/refuser une demande, retirer un ami, envoyer une demande, filtres.
- Notifications : lu/non lu, tout marquer lu, filtres par type, effacement.
- Profil : édition locale persistée, sélecteur de confidentialité, contributions calculées.
- Paramètres : thème sombre/clair, mouvement réduit, économie de batterie, repli 2D,
  qualité de carte, rayon d'alertes, préférences de notifications, réinitialisation, déconnexion.
- SOS : modale explicative + activation/annulation d'une alerte **de démonstration uniquement**.

---

## 8. Responsive

Testé à 1920×1080, 1440×900, 1024×768, 768×1024, 390×844 et 360×800.

- **Desktop / large** : carte plein écran, rail flottant, recherche centrée, panneau d'activité à droite.
- **Tablette** : panneau d'activité masqué, contrôles condensés, grilles 2 colonnes.
- **Mobile** : carte plein écran, barre de recherche compacte, contrôles flottants,
  bottom sheet dépliable, barre d'onglets basse, cibles ≥ 44 px.

---

## 9. Limites connues

1. **Aucun backend** — pas de Socket.io ni d'API ; la « présence temps réel » est simulée.
2. **Géométrie non géoréférencée** — pas de coordonnées GPS/OSM réelles, pas de GPS lu.
3. **Auth non sécurisée** — simulation locale, aucune session serveur, aucun mot de passe stocké.
4. **SOS = maquette** — n'appelle personne, ne transmet aucune position, n'alerte aucun service.
5. **Messagerie absente** — le bouton message affiche un toast explicatif.
6. **Navigation piétonne approximative** — graphe de démonstration sur une colonne vertébrale
   partagée, pas sur les sentiers réels du campus.
7. **i18n partielle** — interface en français ; l'anglais reste à traduire.
8. **PWA partielle** — manifeste + icône + layout mobile installable ; pas de service worker
   d'offline caching (à ajouter avec `next-pwa` ou un SW manuel).
9. **Pas de tests automatisés** — validation faite via `tsc`, `next build` et parcours navigateur
   (0 erreur console sur les 16 écrans vérifiés).
10. **Statistiques de fréquentation** — simulées, jamais présentées comme des données officielles.

---

## 10. Prochaines étapes recommandées (backend)

1. **Données géospatiales réelles** : importer OpenStreetMap (Overpass API) pour les emprises,
   remplacer la géométrie procédurale par des bâtiments extrudés, géoréférencer le repère local.
2. **Routage piéton réel** : exposer `RoutingService.computeRoute()` derrière une API
   (pgRouting / GraphHopper / Valhalla) ; conserver la forme de `PedestrianRoute`.
3. **Auth** : Firebase Auth (email universitaire) ou Supabase Auth ; jetons JWT, rôles
   (étudiant, modérateur, administration).
4. **Temps réel** : Socket.io / Supabase Realtime pour la présence, les alertes et les
   confirmations ; remplacer `presence` mock par des heartbeats throttlés.
5. **Confidentialité** : appliquer les modes côté serveur (géohash tronqué pour « Zone »,
   aucune écriture pour « Fantôme »), journal d'audit, consentement explicite.
6. **Modération des alertes** : scoring de fiabilité par auteur, détection de doublons,
   expiration par TTL serveur, file de vérification.
7. **SOS réel** : intégration du numéro de sécurité du campus, partage de position ponctuel
   avec consentement, journal d'incidents — **jamais** sans validation institutionnelle.
8. **Offline-first** : service worker + IndexedDB (Dexie) pour la carte et les derniers alertes.
9. **Observabilité** : Sentry, Web Vitals, budgets de performance (LCP < 2,5 s en 3G rapide).
10. **Tests** : Playwright (parcours critiques) + Vitest (store, routing, utilitaires).

---

## 11. Accessibilité

- Contrastes vérifiés sur les panneaux flottants ; focus visible sur tous les contrôles.
- Modales fermables avec `Échap`, `aria-modal`, boutons `aria-label`.
- `aria-pressed` sur les bascules de carte, `role="switch"` sur les interrupteurs.
- Respect de `prefers-reduced-motion` **et** d'un réglage applicatif dédié.
- Cibles tactiles ≥ 44 px sur mobile ; navigation clavier sur la barre latérale.

---

*UAC-LIVE 3D — prototype frontend. Toutes les données sont simulées. Aucun service d'urgence
réel n'est contacté, aucune position GPS n'est lue. Projet d'Eucher ABATTI.*
