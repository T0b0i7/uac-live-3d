# ADR-007 — File d'attente hors ligne idempotente

**Statut** : Accepté
**Date** : 2026-01

## Contexte

Le réseau sur le campus d'Abomey-Calavi est irrégulier. Un étudiant doit pouvoir créer un signalement ou envoyer un SOS même quand la connexion tombe au moment de l'envoi. Sans précaution, un rejeu réseau crée des doublons (« 3 signalements identiques ») ou perd des opérations.

## Décision

Toute mutation sensible passe par une **file d'attente locale** (IndexedDB, store `offline_queue`) dont chaque entrée est :

```ts
type QueuedOperation = {
  operationId: string;      // UUID v4 généré côté client, clé d'idempotence
  entityId: string | null;  // entité visée si connue
  action: 'report.create' | 'report.vote' | 'sos.trigger' | 'sos.cancel'
        | 'presence.update' | 'building.verify' | 'building.contribute';
  payload: unknown;
  createdAt: number;        // epoch ms
  retryCount: number;
  synchronizationStatus: 'pending' | 'syncing' | 'synced' | 'failed' | 'rejected';
  lastError: string | null;
  nextRetryAt: number | null;
};
```

## Protocole

1. Le client envoie `operationId` dans l'en-tête `Idempotency-Key` **et** dans le corps.
2. Le serveur persiste `(operation_id, user_id) UNIQUE` dans `audit_logs` (ou une table dédiée) et renvoie **la réponse d'origine** si l'opération a déjà été traitée — jamais une erreur de conflit.
3. Sur échec réseau (pas sur 4xx) : `retryCount++`, backoff exponentiel `min(2^n × 1 s, 5 min)` avec jitter.
4. Sur `4xx` définitif : `synchronizationStatus = 'rejected'`, l'opération sort de la boucle de retry et est **surfacée dans l'UI** (jamais silencieusement perdue).
5. Ordre de synchronisation : FIFO par `createdAt`, sauf `sos.trigger` qui passe en priorité absolue.
6. Les opérations `sos.trigger` non synchronisées restent visibles avec un état explicite « non transmis » — **le produit n'affirme jamais qu'un SOS a été transmis s'il ne l'a pas été**.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| Background Sync seul | Support navigateur hétérogène (iOS Safari limité) ; insuffisant comme unique mécanisme |
| Retry en mémoire | Perdu au rechargement de page |
| Dernier-écrit-gagne sans idempotence | Doublons de signalements et votes comptés plusieurs fois |

## Conséquences

La taille de la file est bornée (200 entrées) ; au-delà, les opérations `presence.update` les plus anciennes sont jetées (elles sont naturellement supersédées), jamais les signalements ni les SOS.
