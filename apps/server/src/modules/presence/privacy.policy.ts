/**
 * Politique de confidentialité GPS — fonction pure (ADR-006)
 *
 * Ce fichier existe pour une raison précise : le filtrage de position ne doit
 * exister qu'à UN seul endroit. HTTP (`PresenceService.nearby`) et Socket.IO
 * (`presence:broadcast`) appellent tous les deux `applyPrivacyPolicy`, ce qui
 * rend structurellement impossible qu'une diffusion temps réel contourne la
 * règle appliquée par l'API REST.
 *
 * Les tests de cette fonction constituent donc les tests d'isolation exigés par
 * le §4 du cahier des charges : si un mode fuite, il fuite partout, et un test
 * échoue.
 */

import { blurPosition } from "@uac/geospatial";
import { LIMITS, type PrivacyMode } from "@uac/shared";

/** Position brute, telle que lue en base (jamais exposée telle quelle). */
export interface RawPosition {
  lat: number;
  lng: number;
}

/** Décision de divulgation pour un observateur donné. */
export interface Disclosure {
  /** Coordonnées divulguées — `null` signifie « aucune coordonnée ». */
  location: RawPosition | null;
  /** Vrai si les coordonnées sont volontairement dégradées. */
  approximate: boolean;
  /** Distance divulguée, éventuellement arrondie — `null` si non calculable. */
  distanceMeters: number | null;
}

export interface DisclosureInput {
  /** Mode courant du propriétaire de la position. */
  ownerMode: PrivacyMode;
  /** L'observateur est-il un ami accepté ? (sans objet en PUBLIC) */
  isFriend: boolean;
  /** Position réelle. */
  actual: RawPosition;
  /** Identité du propriétaire — nécessaire au flou déterministe. */
  ownerId: string;
  /** Distance réelle en mètres, si déjà calculée par PostGIS. */
  realDistanceMeters?: number | null;
  /** Instant de référence (injectable pour les tests). */
  now?: number;
  /** Période du flou : 1 h par défaut, cohérente avec la rotation de zone. */
  blurPeriodMs?: number;
}

const BLUR_PERIOD_MS = 60 * 60 * 1000;

/**
 * Applique la politique de confidentialité et renvoie ce qui peut être divulgué.
 *
 * Règles (dans l'ordre d'évaluation) :
 *  - GHOST         → aucune coordonnée, aucune distance. Toujours.
 *  - BLURRED_ZONE  → coordonnées floues (même pour un ami), distance annulée
 *                    car une distance calculée sur une position floue serait
 *                    un mensonge exploitable.
 *  - FRIENDS_PROMO → exact si ami ; sinon aucune coordonnée et distance
 *                    arrondie à 100 m (pour rester utile sans triangulable).
 *  - PUBLIC        → exact, distance réelle.
 */
export function applyPrivacyPolicy(input: DisclosureInput): Disclosure {
  const realDistance =
    input.realDistanceMeters === undefined || input.realDistanceMeters === null
      ? null
      : Math.round(input.realDistanceMeters);

  switch (input.ownerMode) {
    case "PUBLIC":
      return { location: { ...input.actual }, approximate: false, distanceMeters: realDistance };

    case "FRIENDS_PROMO":
      if (input.isFriend) {
        return { location: { ...input.actual }, approximate: false, distanceMeters: realDistance };
      }
      return {
        location: null,
        approximate: false,
        distanceMeters: realDistance === null ? null : Math.round(realDistance / 100) * 100,
      };

    case "BLURRED_ZONE": {
      const blurred = blurPosition(
        input.actual,
        input.ownerId,
        input.blurPeriodMs ?? BLUR_PERIOD_MS,
        LIMITS.BLURRED_ZONE_RADIUS_M,
        input.now,
      );
      return { location: blurred, approximate: true, distanceMeters: null };
    }

    case "GHOST":
    default:
      return { location: null, approximate: false, distanceMeters: null };
  }
}

/**
 * Vrai si la position exacte peut être divulguée à cet observateur.
 * Utilisé pour décider si un utilisateur entre dans une room de zone précise.
 */
export function mayDiscloseExactPosition(input: {
  ownerMode: PrivacyMode;
  isFriend: boolean;
}): boolean {
  if (input.ownerMode === "PUBLIC") return true;
  if (input.ownerMode === "FRIENDS_PROMO") return input.isFriend;
  // BLURRED_ZONE et GHOST ne divulguent jamais l'exactitude.
  return false;
}

/**
 * Vrai si l'utilisateur doit être totalement exclu des diffusions de position
 * (aucune entrée dans une room de présence, même floue).
 */
export function isPresenceHidden(mode: PrivacyMode): boolean {
  return mode === "GHOST";
}
