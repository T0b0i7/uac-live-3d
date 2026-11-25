/**
 * Constantes et énumérations partagées — @uac/shared
 *
 * Source unique des valeurs autorisées. Toute duplication côté client ou serveur
 * est un défaut : importer depuis ce fichier.
 */

export const ROLES = ["STUDENT", "CONTRIBUTOR", "MODERATOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Hiérarchie numérique : permet `role >= REQUIRED` dans les guards RBAC. */
export const ROLE_RANK: Record<Role, number> = {
  STUDENT: 0,
  CONTRIBUTOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Modes de confidentialité GPS — voir ADR-006. */
export const PRIVACY_MODES = ["PUBLIC", "FRIENDS_PROMO", "BLURRED_ZONE", "GHOST"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const PRESENCE_STATUSES = [
  "ON_CAMPUS",
  "IN_BUILDING",
  "IN_CLASS",
  "STUDYING",
  "BREAK",
  "LEAVING",
  "OFFLINE",
] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const BUILDING_CATEGORIES = [
  "ACADEMIC",
  "AMPHITHEATER",
  "ADMINISTRATIVE",
  "LIBRARY",
  "RESTAURANT",
  "RESIDENCE",
  "SPORT",
  "HEALTH",
  "SERVICE",
  "OTHER",
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

/**
 * Provenance d'une donnée géographique — voir ADR-003.
 *
 * `OSM_IMPORT` est distinct de `OSM` : la migration 0002_osm_geospatial_referential
 * a introduit cette valeur pour distinguer un import automatisé d'une saisie OSM
 * manuelle, et la contrainte CHECK de la table `buildings` l'accepte
 * explicitement. Cette valeur était absente du contrat TypeScript, ce qui faisait
 * échouer la validation Zod de TOUS les bâtiments importés depuis OSM (355 sur
 * 360) et faisait afficher « API injoignable » à l'interface alors que l'API
 * répondait normalement.
 */
export const DATA_SOURCES = ["OSM", "OSM_IMPORT", "INSTITUTIONAL", "STUDENT"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "OUTDATED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const REPORT_CATEGORIES = [
  "MAINTENANCE",
  "SAFETY",
  "CLEANLINESS",
  "CROWD",
  "ACCESSIBILITY",
  "EVENT",
  "LOST_ITEM",
  "OTHER",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = [
  "ACTIVE",
  "CONFIRMED",
  "RESOLVED",
  "EXPIRED",
  "REJECTED",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const SOS_KINDS = ["MEDICAL", "SECURITY", "HARASSMENT", "FIRE", "OTHER"] as const;
export type SosKind = (typeof SOS_KINDS)[number];

export const SOS_STATUSES = ["ACTIVE", "ACKNOWLEDGED", "CANCELLED", "RESOLVED"] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "ALERT",
  "FRIEND_REQUEST",
  "FRIEND_ACCEPTED",
  "REPORT",
  "SOS",
  "STUDY_GROUP",
  "SYSTEM",
  "KARMA",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const VERIFICATION_ACTIONS = ["VERIFY", "REJECT", "REPORT_OUTDATED"] as const;
export type VerificationAction = (typeof VERIFICATION_ACTIONS)[number];

/** Limites dures — protègent la base et le client. */
export const LIMITS = {
  /** Rayon maximal d'une requête de proximité, en mètres. */
  PRESENCE_RADIUS_MAX_M: 5000,
  PRESENCE_RADIUS_DEFAULT_M: 500,
  /** Une présence non rafraîchie expire au bout de ce délai. */
  PRESENCE_TTL_SECONDS: 900,
  /** Rétention maximale d'une position partagée. */
  PRESENCE_MAX_RETENTION_HOURS: 24,
  /** Pagination. */
  PAGE_SIZE_DEFAULT: 20,
  /**
   * Plafond de page.
   *
   * Était fixé à 100 alors que le référentiel OSM contient 360 bâtiments : la
   * carte, qui demandait exactement `limit=100`, n'affichait donc que 100
   * emprises sur 355 géoréférencées, sans le moindre message. Un plafond doit
   * être supérieur au volume réel de la plus grosse collection cartographiable,
   * avec une marge pour la croissance. 1000 couvre le campus avec de l'ordre
   * (≈3× le volume actuel) tout en restant une borne réelle : ce n'est pas une
   * pagination supprimée, c'est un plafond cohérent avec les données.
   */
  PAGE_SIZE_MAX: 1000,
  /** Longueurs de champs. */
  TITLE_MAX: 140,
  BODY_MAX: 4000,
  COMMENT_MAX: 1000,
  BIO_MAX: 500,
  /** Mot de passe. */
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  /** File d'attente hors ligne (voir ADR-007). */
  OFFLINE_QUEUE_MAX: 200,
  /** Rayon du flou de zone, en mètres (voir ADR-006). */
  BLURRED_ZONE_RADIUS_M: 120,
} as const;

/** Durées de vie des jetons — voir ADR-005. */
export const AUTH = {
  ACCESS_TOKEN_TTL: "15m",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_TOKEN_BYTES: 32,
  ARGON2: {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  },
  /** Doit être relevé quand l'algorithme change. */
  PASSWORD_PEPPER_VERSION: 1,
} as const;

/** Paramètres de la navigation piétonne. */
export const NAVIGATION = {
  /** Vitesse de marche moyenne retenue, en mètres par minute. */
  WALK_SPEED_M_PER_MIN: 78,
  /** Facteur de sinuosité appliqué aux distances à vol d'oiseau. */
  MEANDER_FACTOR: 1.18,
  /** Distance maximale d'accroche (snapping) d'un point au graphe. */
  SNAP_MAX_DISTANCE_M: 150,
  /** Pénalité appliquée aux arêtes non accessibles PMR. */
  NON_ACCESSIBLE_PENALTY: 1.6,
} as const;

/** Coordonnées de référence du campus d'Abomey-Calavi (centre approximatif). */
export const CAMPUS_ANCHOR = {
  latitude: 6.4147,
  longitude: 2.3407,
  /** Demi-étendue de la boîte englobante par défaut, en degrés. */
  bboxDelta: 0.02,
} as const;
