# ADR-001 — Monolithe modulaire plutôt que microservices

**Statut** : Accepté
**Date** : 2026-01
**Décideurs** : Principal Architect, Backend Lead

## Contexte

UAC-Live 3D couvre 15 domaines métier (identité, présence, navigation, signalements, SOS, gamification, modération…). La tentation d'un découpage microservices est forte sur le papier, mais l'équipe est réduite, la charge réelle du campus est de l'ordre de quelques milliers d'utilisateurs simultanés au pic, et aucun domaine n'a encore de frontière de données stable et prouvée.

## Décision

Construire **un monolithe modulaire** organisé en 15 modules métier, chacun avec quatre couches internes (`domain`, `application`, `infrastructure`, `presentation`). Les modules ne communiquent que par des interfaces applicatives exportées, jamais par import direct dans les couches internes d'un autre module.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Microservices dès le départ | Coût opérationnel (15 pipelines, 15 bases, service mesh) sans bénéfice mesurable ; multiplication des défaillances partielles |
| Monolithe en couches techniques (`controllers/`, `services/`, `models/`) | Les frontières métier deviennent invisibles ; extraction ultérieure impossible sans réécriture |
| Serverless par fonction | Cold starts incompatibles avec la présence temps réel WebSocket |

## Conséquences

**Positives** : une seule transaction PostgreSQL peut couvrir plusieurs domaines (ex. signalement + karma + notification) ; un seul déploiement ; débogage local trivial ; refactoring des frontières facile tant que le code est jeune.

**Négatives** : discipline d'équipe obligatoire, sinon le monolithe se dégrade en "big ball of mud". Mesure compensatoire : lint d'imports inter-modules (voir `docs/architecture/backend.md`) et revue de code sur toute nouvelle dépendance entre modules.

**Chemin d'extraction** : chaque module expose déjà ses cas d'usage via une interface ; extraire `presence` ou `notifications` vers un service séparé ne demandera que de remplacer l'implémentation de l'interface par un client HTTP/AMQP.
