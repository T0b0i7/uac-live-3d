# ADR-006 — Modèle de confidentialité GPS à quatre modes

**Statut** : Accepté
**Date** : 2026-01

## Contexte

La position GPS d'un étudiant est une donnée personnelle sensible : elle révèle ses horaires, ses fréquentations, ses habitudes. Le produit repose pourtant sur la visibilité des présences. Il faut donc un spectre de consentement, pas un interrupteur binaire.

## Décision — quatre modes, un seul point de décision serveur

| Mode | Ce que le serveur stocke | Ce qu'un autre utilisateur reçoit |
|---|---|---|
| `PUBLIC` | Position exacte (précision déclarée) | Position exacte, `displayName` complet |
| `FRIENDS_PROMO` | Position exacte | Position exacte **uniquement pour les amis confirmés** ; les autres reçoivent `null` |
| `BLURRED_ZONE` | Position exacte, **jamais diffusée** | Position **snappée au centre de la zone** (bâtiment le plus proche + rayon de 120 m) ; sur les amis aussi |
| `GHOST` | Position exacte conservée pour la navigation personnelle | **Rien**. L'utilisateur n'apparaît dans aucun résultat `presence/nearby` |

## Règles d'implémentation non négociables

1. **Le filtrage est serveur, jamais client.** Le client ne reçoit pas de coordonnées qu'il n'a pas le droit de voir — on ne "cache" pas côté UI.
2. **Le calcul de proximité se fait avant filtrage**, sur la position réelle, puis la réponse est *dégradée* selon le mode du propriétaire.
3. **`BLURRED_ZONE` doit dégrader même pour les amis** : c'est le sens du mode.
4. **Une position expirée n'est jamais diffusée** : `user_presence.share_expires_at < now()` ⇒ traitée comme `GHOST`.
5. **Aucune coordonnée privée dans les logs.** Les logs structurés pino n'incluent jamais `lat`/`lng`/`geom` ; seule l'entité concernée (`userId`, `buildingId`) est loguée.
6. **Le consentement est horodaté** : `user_presence.consent_given_at` obligatoire, et changer de mode le remet à jour.
7. **Rétention** : purge automatique des positions dont `share_expires_at` dépasse 24 h (tâche `workers/purge-presence.ts`).

## Tests obligatoires

- A (PUBLIC) voit B (PUBLIC) : position exacte identique.
- A (non ami) ne voit pas B (FRIENDS_PROMO) : `null`.
- A (ami) voit B (FRIENDS_PROMO) : position exacte.
- A (ami) voit B (BLURRED_ZONE) : position **snappée**, jamais exacte.
- N'importe qui demandant B (GHOST) : absent du tableau.
- Position expirée de B (PUBLIC) : absente du tableau.
- L'API `/presence/nearby` ne renvoie **aucun** champ `lat`/`lng` brut quand le demandeur n'y a pas droit.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Interrupteur on/off | Ne permet pas de socialiser sans exposer sa position exacte |
| Flou gaussien aléatoire | Non déterministe, permet de trianguler par requêtes répétées |
| Filtrage côté client | Contournable en lisant la réponse réseau |
| Partage uniquement sur action explicite (« check-in ») | Trop frictionnel pour le cas d'usage « voir qui est à la bibliothèque » |
