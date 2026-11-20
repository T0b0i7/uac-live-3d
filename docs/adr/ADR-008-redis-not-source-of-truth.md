# ADR-008 — Redis est volatile, jamais source de vérité

**Statut** : Accepté
**Date** : 2026-01

## Contexte

Redis est utilisé pour quatre usages différents (présence temps réel, cache, rate limiting, Pub/Sub Socket.IO). Le risque classique est de le laisser devenir une base de données de fait, puis de perdre des données au redémarrage.

## Décision

| Usage Redis | Clé | TTL | Perte acceptable ? |
|---|---|---|---|
| Présence chaude | `presence:{buildingId}` (hash) | 5 min, rafraîchi par heartbeat | **Oui** — reconstruite depuis `user_presence` |
| Cache de lecture (liste bâtiments, GeoJSON) | `cache:{route}:{hash}` | 60 s – 10 min | Oui |
| Rate limiting | `rl:{scope}:{id}` | fenêtre glissante | Oui (reset du compteur) |
| Pub/Sub Socket.IO | canaux `socket.io#*` | — | Oui |
| Sessions de socket | `socket:{userId}` → `socketId` | 24 h | Oui |

**Toute donnée dont la perte est inacceptable vit dans PostgreSQL.** Les positions persistées, les signalements, les SOS, les jetons, l'audit : PostgreSQL uniquement.

## Règle de reconstruction

Au démarrage, si Redis est vide, le serveur doit fonctionner : le cache se réchauffe à la demande, et la présence est relue depuis `user_presence` pour les positions non expirées. **Aucune fonctionnalité ne doit être indisponible parce que Redis a redémarré** — seule la latence augmente.

## Dégradation gracieuse

`apps/server` démarre en mode `REDIS_OPTIONAL=true` : si la connexion échoue, un avertissement est logué, un cache mémoire de secours (Map avec TTL) prend le relais et la présence intra-processus est utilisée. Le mode `REDIS_REQUIRED=true` (production, multi-instance) fait échouer le démarrage si Redis est absent — car sans lui, la diffusion entre instances est silencieusement cassée.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Tout en PostgreSQL (advisory locks, LISTEN/NOTIFY) | Suffisant pour la persistance, insuffisant pour la présence à haute fréquence (heartbeats toutes les 15 s × N utilisateurs) |
| Mémoire process uniquement | Incompatible avec plusieurs instances ; perte totale au redéploiement |
| Kafka | Complexité opérationnelle injustifiée à cette échelle |
