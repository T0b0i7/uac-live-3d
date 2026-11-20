# ADR-005 — JWT courte durée + rotation des refresh tokens

**Statut** : Accepté
**Date** : 2026-01

## Contexte

L'application est utilisée sur des téléphones personnels, souvent partagés, dans un contexte de réseau instable (campus dense, 3G/4G saturée). Il faut des sessions longues sans exposer un jeton de longue durée volable.

## Décision

| Élément | Choix | Durée |
|---|---|---|
| Mot de passe | **Argon2id** (mémoire 19 MiB, 2 itérations, parallélisme 1) | — |
| Access token | JWT HS256 signé, porté en `Authorization: Bearer` | **15 min** |
| Refresh token | Chaîne opaque 256 bits, **hachée en base** (SHA-256) | **30 jours** |
| Rotation | Chaque `/auth/refresh` **invalide l'ancien** et émet un nouveau couple | à chaque usage |
| Détection de rejeu | Si un refresh déjà consommé est présenté → **révocation de toute la famille** de tokens de l'utilisateur + audit log | immédiat |
| Révocation | `refresh_tokens.revoked_at` + `revoked_reason` | sur logout / rejeu / changement de mot de passe |
| Stockage côté client | `sessionStorage` pour l'access token, refresh en cookie `HttpOnly` `Secure` `SameSite=Lax` quand le mode cookie est activé | — |

## Pourquoi pas de JWT longue durée

Un JWT est **non révocable** par nature. Le raccourcir à 15 minutes borne la fenêtre d'exploitation d'un vol. La révocation réelle passe par la table `refresh_tokens`.

## Anti-patterns explicitement rejetés

- Stocker le refresh token **en clair** en base (une fuite de dump = prise de contrôle de tous les comptes).
- `localStorage` pour le refresh token (accessible à tout XSS).
- JWT dans un cookie sans protection CSRF.
- Secret JWT par défaut en production : le serveur **refuse de démarrer** si `JWT_SECRET` fait moins de 32 caractères ou vaut une valeur d'exemple connue.

## Conséquences

Nécessite un aller-retour serveur toutes les 15 minutes par utilisateur actif — négligeable. Permet une déconnexion globale instantanée et une détection de vol de jeton.
