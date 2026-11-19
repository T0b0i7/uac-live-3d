# CLAUDE.md — UAC-LIVE 3D

Prototype frontend Next.js 15 (App Router) + React 19 + TS strict + Tailwind v4 + R3F.
Projet owner: Eucher ABATTI. Toutes les données sont simulées.

## Commandes
```bash
npm run dev        # http://localhost:3000
npm run build      # build production (15 routes statiques)
npm start          # serveur production
npm run typecheck  # tsc --noEmit
```

## Règles importantes
- **Zustand v5** : tout sélecteur dérivé (`.filter`, `.map`, objet littéral) DOIT être enveloppé
  dans `useShallow` de `zustand/react/shallow`, sinon boucle de rendu infinie (React #185).
- Persistance : clé `uac-live-3d:v1`, `partialize` dans `src/store/useAppStore.ts`.
- Le design system vit dans `src/styles/globals.css` (`@theme` + tokens `--bg-panel`, `--accent`).
  Utiliser les utilitaires `panel`, `glass`, `text-dim`, `hairline` plutôt que des couleurs brutes.
- Ne jamais présenter les coordonnées de `src/data/buildings.ts` comme géoréférencées.
- Le SOS doit rester explicitement une démonstration (pas d'appel, pas de GPS).
- La route `/map` rend son propre rail flottant : `AppShell` masque sa sidebar sur ce chemin.

## Ajouter un module
1. Créer `src/app/(app)/<route>/page.tsx` (client component).
2. Ajouter l'entrée dans `NAV_ITEMS` (`src/components/layout/Sidebar.tsx`).
3. Ajouter un onglet dans `MobileTabBar` si critique sur mobile.
4. Réutiliser `Button`, `Badge`, `Field`, `Modal`, `Switch` depuis `@/components/ui/primitives`.
