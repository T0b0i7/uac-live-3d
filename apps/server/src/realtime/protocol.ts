/**
 * Protocole temps réel — apps/server/src/realtime/protocol.ts
 *
 * Source unique de vérité pour les noms d'événements et de rooms. Le client
 * importe les mêmes constantes : un renommage casse la compilation des deux
 * côtés, jamais silencieusement la production.
 *
 * Principe de conception : aucune room ne contient de position exacte.
 *  - `user:{id}`      → canal privé (notifications, son propre état)
 *  - `zone:{lat}:{lng}` → cellule d'environ 111 m ; sert au fan-out de proximité
 *  - `staff`          → MODERATOR et ADMIN uniquement (modération, SOS)
 *  - `faculty:{id}`   → fil thématique facultaire
 */

import type { NearbyPresence, Notification, Report, SosAlert } from "@uac/contracts";
import type { PresenceStatus, PrivacyMode, Role } from "@uac/shared";

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export const ROOM_USER_PREFIX = "user:";
export const ROOM_ZONE_PREFIX = "zone:";
export const ROOM_FACULTY_PREFIX = "faculty:";
export const ROOM_STAFF = "staff";

export function userRoom(userId: string): string {
  return `${ROOM_USER_PREFIX}${userId}`;
}

export function facultyRoom(facultyId: string): string {
  return `${ROOM_FACULTY_PREFIX}${facultyId}`;
}

/**
 * Arrondit au millième de degré (≈ 111 m en latitude). C'est la granularité
 * maximale qu'un observateur non autorisé peut déduire : la cellule elle-même.
 */
export function zoneKeyOf(lat: number, lng: number): string {
  const decimals = 3;
  return `${ROOM_ZONE_PREFIX}${lat.toFixed(decimals)}:${lng.toFixed(decimals)}`;
}

/**
 * Cellules à couvrir pour une diffusion « à proximité ». On inclut les 8
 * voisines afin qu'un utilisateur situé juste de l'autre côté d'une frontière
 * de cellule reçoive l'événement. Couverture ≈ 333 m × 333 m.
 */
export function neighbourZoneKeys(lat: number, lng: number): string[] {
  const step = 0.001;
  const keys: string[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      keys.push(zoneKeyOf(lat + dLat * step, lng + dLng * step));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Données de socket
// ---------------------------------------------------------------------------

/** Contexte attaché à chaque socket après authentification du handshake. */
export interface SocketData {
  userId: string;
  role: Role;
  email: string;
  facultyId: string | null;
  connectedAt: number;
}

// ---------------------------------------------------------------------------
// Charges utiles
// ---------------------------------------------------------------------------

/** Une entrée de présence telle que diffusée — déjà filtrée par le serveur. */
export interface PresenceBroadcastEntry {
  userId: string;
  fullName: string;
  avatarSeed: string;
  status: PresenceStatus;
  privacyMode: PrivacyMode;
  /** `null` = aucune coordonnée divulguée à CE destinataire. */
  location: { lat: number; lng: number } | null;
  approximate: boolean;
  distanceMeters: number | null;
  buildingId: string | null;
  buildingName: string | null;
  isFriend: boolean;
  updatedAt: string;
}

export interface PresenceSnapshot {
  zone: string;
  entries: PresenceBroadcastEntry[];
  /** Horodatage serveur : le client peut détecter une horloge décalée. */
  serverTime: string;
}

export interface HeartbeatAck {
  serverTime: string;
  /** Secondes restantes avant expiration de la position partagée. */
  expiresInSeconds: number;
  onlineCount: number;
}

export interface SosAck {
  alert: SosAlert;
  /**
   * Mention explicite : l'application NE transmet PAS aux services d'urgence.
   * L'alerte est visible par les modérateurs connectés, rien de plus.
   */
  disclaimer: string;
  notifiedModerators: number;
}

/** Événements serveur → client. */
export interface ServerToClientEvents {
  "presence:snapshot": (payload: PresenceSnapshot) => void;
  "presence:update": (entry: PresenceBroadcastEntry) => void;
  "presence:offline": (payload: { userId: string; at: string }) => void;
  "presence:expired": (payload: { userIds: string[]; at: string }) => void;
  "report:created": (report: Report) => void;
  "report:updated": (payload: { reportId: string; status: string; confirmations: number }) => void;
  "notification:new": (notification: Notification) => void;
  "sos:created": (alert: SosAlert) => void;
  "sos:acknowledged": (payload: { alertId: string; byUserId: string; at: string }) => void;
  "auth:expired": (payload: { reason: string }) => void;
  "server:ping": (payload: { serverTime: string }) => void;
}

/** Événements client → serveur. */
export interface ClientToServerEvents {
  "presence:subscribe": (payload: { lat: number; lng: number }) => void;
  "presence:unsubscribe": () => void;
  "presence:heartbeat": (ack?: (payload: HeartbeatAck) => void) => void;
  "report:subscribe": () => void;
  "sos:create": (
    payload: {
      kind: "MEDICAL" | "SECURITY" | "HARASSMENT" | "FIRE" | "OTHER";
      location: { lat: number; lng: number } | null;
      buildingId?: string | null;
      message?: string | null;
    },
    ack?: (payload: SosAck | { error: { code: string; message: string } }) => void,
  ) => void;
}

/** Événements entre instances (adaptateur Redis). */
export interface InterServerEvents {
  ping: () => void;
}

export type { NearbyPresence, Notification, Report, SosAlert };
