/**
 * Contrats d'échange — @uac/contracts
 *
 * Source unique de vérité (voir ADR-010). Le serveur valide avec ces schémas,
 * le client infère ses types avec `z.infer`. Toute évolution d'API commence ici.
 */

import { z } from "zod";
import {
  BUILDING_CATEGORIES,
  DATA_SOURCES,
  LIMITS,
  NOTIFICATION_TYPES,
  PRIVACY_MODES,
  PRESENCE_STATUSES,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  ROLES,
  SOS_KINDS,
  SOS_STATUSES,
  VERIFICATION_ACTIONS,
  VERIFICATION_STATUSES,
} from "@uac/shared";

// ---------------------------------------------------------------------------
// Primitives réutilisables
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid("Identifiant invalide (UUID attendu).");

/** Coordonnée WGS84 valide. Rejette NaN, Infinity, et les valeurs hors bornes. */
export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90, "Latitude hors bornes [-90, 90]."),
  lng: z.number().min(-180).max(180, "Longitude hors bornes [-180, 180]."),
});

/**
 * Coordonnée du campus uniquement. On refuse les points manifestement hors
 * campus plutôt que de les accepter silencieusement : un point à Paris est
 * presque toujours une erreur d'unité (degrés vs mètres) ou un GPS fou.
 */
export const campusCoordinateSchema = coordinateSchema.refine(
  (c) => c.lat >= 6.2 && c.lat <= 6.6 && c.lng >= 2.1 && c.lng <= 2.6,
  {
    message:
      "Coordonnée hors de la zone du campus d'Abomey-Calavi (6.2–6.6 N / 2.1–2.6 E). Vérifiez que vous n'avez pas envoyé des mètres au lieu de degrés.",
  },
);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
});

/** Identifiant d'idempotence fourni par le client (voir ADR-007). */
export const idempotencyKeySchema = z
  .string()
  .uuid("La clé d'idempotence doit être un UUID v4 généré côté client.");

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

const emailSchema = z
  .string()
  .min(5, "Email trop court.")
  .max(254, "Email trop long.")
  .email("Format d'email invalide.")
  .transform((v) => v.trim().toLowerCase());

/**
 * Mot de passe : 10 caractères minimum, au moins une lettre et un chiffre.
 * On n'impose PAS de caractère spécial arbitraire (inefficace en pratique) mais
 * on bloque les mots de passe notoirement compromis côté serveur (liste).
 */
const passwordSchema = z
  .string()
  .min(LIMITS.PASSWORD_MIN, `Le mot de passe doit contenir au moins ${LIMITS.PASSWORD_MIN} caractères.`)
  .max(LIMITS.PASSWORD_MAX, `Le mot de passe ne peut dépasser ${LIMITS.PASSWORD_MAX} caractères.`)
  .refine((v) => /[a-zA-Z]/.test(v), "Le mot de passe doit contenir au moins une lettre.")
  .refine((v) => /[0-9]/.test(v), "Le mot de passe doit contenir au moins un chiffre.");

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z
    .string()
    .min(2, "Le nom complet doit contenir au moins 2 caractères.")
    .max(120, "Le nom complet est trop long.")
    .transform((v) => v.trim().replace(/\s+/g, " ")),
  matricule: z
    .string()
    .min(4, "Matricule trop court.")
    .max(32, "Matricule trop long.")
    .regex(/^[A-Za-z0-9-]+$/, "Le matricule ne peut contenir que des lettres, chiffres et tirets.")
    .transform((v) => v.trim().toUpperCase()),
  facultyId: uuidSchema,
  departmentId: uuidSchema.optional(),
  level: z.enum(["L1", "L2", "L3", "M1", "M2", "D1", "D2"]),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis."),
});

export const refreshBodySchema = z.object({
  /** Optionnel : quand le mode cookie est actif, le refresh arrive par cookie. */
  refreshToken: z.string().min(16).optional(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  /** Durée de vie en secondes, pour planifier le refresh côté client. */
  expiresIn: z.number().int().positive(),
  tokenType: z.literal("Bearer"),
});

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

export const privacyModeSchema = z.enum(PRIVACY_MODES);
export const presenceStatusSchema = z.enum(PRESENCE_STATUSES);
export const roleSchema = z.enum(ROLES);

export const publicUserSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  avatarSeed: z.string(),
  facultyId: uuidSchema.nullable(),
  facultyName: z.string().nullable(),
  department: z.string().nullable(),
  level: z.string().nullable(),
  bio: z.string().nullable(),
  role: roleSchema,
  karma: z.number().int(),
  /** Le matricule n'est JAMAIS exposé publiquement en clair. */
  matriculeMasked: z.string().nullable(),
  privacyMode: privacyModeSchema,
  createdAt: z.string(),
});

export const selfUserSchema = publicUserSchema.extend({
  email: z.string(),
  matricule: z.string(),
  isVerified: z.boolean(),
  onboardingCompleted: z.boolean(),
});

export const updateProfileBodySchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    bio: z.string().max(LIMITS.BIO_MAX).nullable().optional(),
    avatarSeed: z.string().min(1).max(64).optional(),
    department: z.string().max(120).nullable().optional(),
    level: z.enum(["L1", "L2", "L3", "M1", "M2", "D1", "D2"]).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Aucun champ à mettre à jour.",
  });

// ---------------------------------------------------------------------------
// Bâtiments
// ---------------------------------------------------------------------------

export const buildingCategorySchema = z.enum(BUILDING_CATEGORIES);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const dataSourceSchema = z.enum(DATA_SOURCES);

/**
 * GeoJSON Polygon en SRID 4326 : [ [ [lng, lat], ... ] ]
 * On valide la structure minimale ET les bornes des coordonnées.
 */
export const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4))
    .min(1),
});

export const buildingSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  category: buildingCategorySchema,
  facultyId: uuidSchema.nullable(),
  facultyName: z.string().nullable(),
  description: z.string().nullable(),
  floors: z.number().int().positive(),
  /** Aire calculée côté serveur en m² (jamais saisie à la main). */
  footprintAreaM2: z.number().nonnegative().nullable(),
  /** Centroïde réel, pour centrer la carte sans charger le polygone. */
  centroid: coordinateSchema.nullable(),
  geometry: polygonGeometrySchema.nullable(),
  source: dataSourceSchema,
  verificationStatus: verificationStatusSchema,
  lastVerifiedAt: z.string().nullable(),
  /** Vrai si la géométrie provient d'une source institutionnelle vérifiée. */
  isGeoreferenced: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Emprise minimale destinée au rendu cartographique.
 *
 * Plus légère que `buildingSchema` : la carte n'a besoin ni de la description,
 * ni de la faculté détaillée. Utilisée par `GET /api/v1/buildings/map`, qui
 * renvoie toutes les emprises sans pagination.
 */
export const mapBuildingSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  category: buildingCategorySchema,
  floors: z.number().int().positive(),
  footprintAreaM2: z.number().nonnegative().nullable(),
  geometry: polygonGeometrySchema.nullable(),
  centroid: coordinateSchema.nullable(),
  source: dataSourceSchema,
  verificationStatus: verificationStatusSchema,
  /** Vrai si une emprise géographique exploitable existe. */
  isGeoreferenced: z.boolean(),
});

export const createBuildingBodySchema = z.object({
  code: z.string().min(2).max(24).transform((v) => v.trim().toUpperCase()),
  name: z.string().min(2).max(160),
  shortName: z.string().max(24).nullable().optional(),
  category: buildingCategorySchema,
  facultyId: uuidSchema.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  floors: z.number().int().min(1).max(60).default(1),
  geometry: polygonGeometrySchema.nullable().optional(),
  centroid: campusCoordinateSchema.nullable().optional(),
});

export const updateBuildingBodySchema = createBuildingBodySchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Aucun champ à mettre à jour." },
);

export const buildingsQuerySchema = paginationQuerySchema.extend({
  category: buildingCategorySchema.optional(),
  facultyId: uuidSchema.optional(),
  search: z.string().max(120).optional(),
  verificationStatus: verificationStatusSchema.optional(),
  /** Filtre spatial : ne renvoyer que les bâtiments intersectant la boîte. */
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "bbox attendu : minLng,minLat,maxLng,maxLat")
    .optional(),
});

export const verifyBuildingBodySchema = z.object({
  action: z.enum(VERIFICATION_ACTIONS),
  comment: z.string().max(LIMITS.COMMENT_MAX).optional(),
});

// ---------------------------------------------------------------------------
// Facultés et salles
// ---------------------------------------------------------------------------

export const facultySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  description: z.string().nullable(),
  buildingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const roomSchema = z.object({
  id: uuidSchema,
  buildingId: uuidSchema,
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().nonnegative(),
  floor: z.number().int(),
  roomType: z.enum(["AMPHI", "CLASSROOM", "LAB", "OFFICE", "LIBRARY", "OTHER"]),
  isAccessible: z.boolean(),
  isOpen: z.boolean(),
  createdAt: z.string(),
});

export const createRoomBodySchema = z.object({
  code: z.string().min(1).max(24).transform((v) => v.trim().toUpperCase()),
  name: z.string().min(1).max(120),
  capacity: z.number().int().min(0).max(5000),
  floor: z.number().int().min(-2).max(60),
  roomType: z.enum(["AMPHI", "CLASSROOM", "LAB", "OFFICE", "LIBRARY", "OTHER"]),
  isAccessible: z.boolean().default(false),
  isOpen: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Présence
// ---------------------------------------------------------------------------

export const updatePresenceBodySchema = z.object({
  status: presenceStatusSchema,
  /**
   * Optionnel ET nullable : en mode GHOST (ou GPS indisponible), le client
   * n'envoie aucune position. `null` explicite = « je retire ma position ».
   */
  location: campusCoordinateSchema.nullable().optional(),
  /** Précision déclarée du GPS en mètres. */
  accuracyMeters: z.number().min(0).max(5000).nullable().optional(),
  buildingId: uuidSchema.nullable().optional(),
  /** Durée de partage demandée, bornée par LIMITS.PRESENCE_MAX_RETENTION_HOURS. */
  shareForMinutes: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.PRESENCE_MAX_RETENTION_HOURS * 60)
    .default(120),
});

export const updatePrivacyBodySchema = z.object({
  privacyMode: privacyModeSchema,
});

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce
    .number()
    .int()
    .min(10)
    .max(LIMITS.PRESENCE_RADIUS_MAX_M)
    .default(LIMITS.PRESENCE_RADIUS_DEFAULT_M),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * Présence telle que diffusée. `location` est `null` quand l'utilisateur n'a pas
 * le droit de voir la position exacte (voir ADR-006). `approximate` indique que
 * la position a été dégradée.
 */
export const nearbyPresenceSchema = z.object({
  userId: uuidSchema,
  fullName: z.string(),
  avatarSeed: z.string(),
  status: presenceStatusSchema,
  privacyMode: privacyModeSchema,
  location: coordinateSchema.nullable(),
  approximate: z.boolean(),
  distanceMeters: z.number().nonnegative().nullable(),
  buildingId: uuidSchema.nullable(),
  buildingName: z.string().nullable(),
  isFriend: z.boolean(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const routeRequestSchema = z.object({
  from: campusCoordinateSchema,
  to: campusCoordinateSchema,
  accessibleOnly: z.boolean().default(false),
  algorithm: z.enum(["dijkstra", "astar"]).default("astar"),
});

export const routeStepSchema = z.object({
  index: z.number().int().nonnegative(),
  instruction: z.string(),
  distanceMeters: z.number().nonnegative(),
  bearingDegrees: z.number().min(0).max(360),
  coordinate: coordinateSchema,
  landmark: z.string().nullable(),
});

export const routeResponseSchema = z.object({
  found: z.boolean(),
  distanceMeters: z.number().nonnegative(),
  estimatedMinutes: z.number().nonnegative(),
  straightLineMeters: z.number().nonnegative(),
  usesNonAccessible: z.boolean(),
  polyline: z.array(coordinateSchema),
  steps: z.array(routeStepSchema),
  /**
   * Qualité du tracé. Le réseau piéton d'OpenStreetMap du campus est réel mais
   * fragmenté (55 composantes connexes mesurées) : deux points peuvent être
   * géographiquement proches sans qu'aucun cheminement cartographié ne les
   * relie. Dans ce cas, on ne fabrique pas de tracé le long de voies
   * imaginaires : on renvoie `partial_direct` et un segment direct, clairement
   * signalé comme indicatif.
   *
   * - `on_network`     : tracé continu réellement issu du réseau OSM ;
   * - `partial_direct` : aucun chemin continu ; distance à vol d'oiseau ;
   * - `not_found`      : aucun itinéraire calculable.
   */
  quality: z.enum(["on_network", "partial_direct", "not_found"]),
  /** Avertissement explicite si le graphe n'est pas validé géographiquement. */
  disclaimer: z.string(),
});

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

export const reportCategorySchema = z.enum(REPORT_CATEGORIES);
export const reportStatusSchema = z.enum(REPORT_STATUSES);

export const reportSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string().nullable(),
  category: reportCategorySchema,
  status: reportStatusSchema,
  severity: z.number().int().min(1).max(5),
  location: coordinateSchema,
  buildingId: uuidSchema.nullable(),
  buildingName: z.string().nullable(),
  authorId: uuidSchema,
  authorName: z.string(),
  confirmations: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  /** Vote de l'utilisateur courant : +1, -1, ou 0. */
  myVote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export const createReportBodySchema = z.object({
  title: z.string().min(4, "Titre trop court.").max(LIMITS.TITLE_MAX),
  body: z.string().max(LIMITS.BODY_MAX).nullable().optional(),
  category: reportCategorySchema,
  severity: z.number().int().min(1).max(5).default(2),
  location: campusCoordinateSchema,
  buildingId: uuidSchema.nullable().optional(),
});

export const voteReportBodySchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1)]),
});

export const reportsQuerySchema = paginationQuerySchema.extend({
  category: reportCategorySchema.optional(),
  status: reportStatusSchema.optional(),
  buildingId: uuidSchema.optional(),
  sort: z.enum(["recent", "confirmations", "severity"]).default("recent"),
});

// ---------------------------------------------------------------------------
// SOS
// ---------------------------------------------------------------------------

export const sosKindSchema = z.enum(SOS_KINDS);
export const sosStatusSchema = z.enum(SOS_STATUSES);

export const sosAlertSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  kind: sosKindSchema,
  status: sosStatusSchema,
  location: coordinateSchema.nullable(),
  buildingId: uuidSchema.nullable(),
  buildingName: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  /** Vrai si l'alerte a été créée localement et n'a PAS encore atteint le serveur. */
  pendingSync: z.boolean(),
});

export const createSosBodySchema = z.object({
  kind: sosKindSchema,
  location: campusCoordinateSchema.nullable(),
  buildingId: uuidSchema.nullable().optional(),
  message: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export const contributionSchema = z.object({
  id: uuidSchema,
  targetType: z.enum(["BUILDING", "ROOM", "WALKWAY"]),
  targetId: uuidSchema,
  payload: z.unknown(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  authorId: uuidSchema,
  authorName: z.string(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  reviewerNote: z.string().nullable(),
});

export const reviewContributionBodySchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(LIMITS.COMMENT_MAX).optional(),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationSchema = z.object({
  id: uuidSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  read: z.boolean(),
  /** Lien interne optionnel (ex. `/alerts?focus=xxx`). */
  actionUrl: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationsQuerySchema = paginationQuerySchema.extend({
  type: notificationTypeSchema.optional(),
  unreadOnly: z.coerce.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export const adminDashboardSchema = z.object({
  totals: z.object({
    users: z.number().int().nonnegative(),
    students: z.number().int().nonnegative(),
    buildings: z.number().int().nonnegative(),
    verifiedBuildings: z.number().int().nonnegative(),
    activeReports: z.number().int().nonnegative(),
    activeSos: z.number().int().nonnegative(),
    pendingContributions: z.number().int().nonnegative(),
  }),
  presence: z.object({
    sharing: z.number().int().nonnegative(),
    ghost: z.number().int().nonnegative(),
    blurred: z.number().int().nonnegative(),
  }),
  recent: z.array(
    z.object({
      at: z.string(),
      actor: z.string(),
      action: z.string(),
      target: z.string().nullable(),
    }),
  ),
});

export const auditLogSchema = z.object({
  id: uuidSchema,
  actorId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ipHash: z.string().nullable(),
  createdAt: z.string(),
  metadata: z.unknown().nullable(),
});

// ---------------------------------------------------------------------------
// Types inférés — jamais écrits à la main (ADR-010)
// ---------------------------------------------------------------------------

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type AuthTokens = z.infer<typeof authTokensSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type SelfUser = z.infer<typeof selfUserSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type Building = z.infer<typeof buildingSchema>;
export type MapBuilding = z.infer<typeof mapBuildingSchema>;
export type CreateBuildingBody = z.infer<typeof createBuildingBodySchema>;
export type UpdateBuildingBody = z.infer<typeof updateBuildingBodySchema>;
export type BuildingsQuery = z.infer<typeof buildingsQuerySchema>;
export type VerifyBuildingBody = z.infer<typeof verifyBuildingBodySchema>;
export type Faculty = z.infer<typeof facultySchema>;
export type Room = z.infer<typeof roomSchema>;
export type CreateRoomBody = z.infer<typeof createRoomBodySchema>;
export type UpdatePresenceBody = z.infer<typeof updatePresenceBodySchema>;
export type UpdatePrivacyBody = z.infer<typeof updatePrivacyBodySchema>;
export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
export type NearbyPresence = z.infer<typeof nearbyPresenceSchema>;
export type RouteRequest = z.infer<typeof routeRequestSchema>;
export type RouteResponse = z.infer<typeof routeResponseSchema>;
export type RouteStep = z.infer<typeof routeStepSchema>;
export type Report = z.infer<typeof reportSchema>;
export type CreateReportBody = z.infer<typeof createReportBodySchema>;
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;
export type SosAlert = z.infer<typeof sosAlertSchema>;
export type CreateSosBody = z.infer<typeof createSosBodySchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
export type PolygonGeometry = z.infer<typeof polygonGeometrySchema>;
export type Coordinate = z.infer<typeof coordinateSchema>;
