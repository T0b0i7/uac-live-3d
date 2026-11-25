/**
 * Accès aux endpoints réels de l'API UAC-Live 3D.
 *
 * Chaque fonction est volontairement mince : elle ne fait que traduire un
 * endpoint en type. Toute la mécanique (timeout, auth, erreurs) vit dans
 * `client.ts`.
 *
 * Aucun tableau statique, aucune donnée de secours : si le serveur ne renvoie
 * rien, la fonction renvoie une liste vide — et l'interface l'affiche comme
 * telle (« aucun bâtiment »), sans jamais inventer.
 */

import {
  buildingSchema,
  mapBuildingSchema,
  facultySchema,
  reportSchema,
  roomSchema,
  type Building,
  type Faculty,
  type Report,
  type Room,
} from "@uac/contracts";
import { z } from "zod";
import {
  API_URL,
  ApiError,
  apiFetch,
  apiFetchValidated,
  apiFetchValidatedList,
  queryString,
  type ApiEnvelope,
  type PaginationMeta,
  type RequestOptions,
} from "./client";

// ---------------------------------------------------------------------------
// Types propres au web (le graphe n'a pas de schéma dans @uac/contracts)
// ---------------------------------------------------------------------------

export interface GraphNodeDto {
  id: string;
  type: string;
  lat: number;
  lng: number;
  label: string | null;
  accessible: boolean;
}

export interface GraphEdgeDto {
  id: string;
  source: string;
  target: string;
  distanceMeters: number;
  accessible: boolean;
  restrictions: string[] | null;
  surface: string | null;
}

export interface PedestrianGraphDto {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  nodeCount: number;
  edgeCount: number;
  accessibleEdgeCount: number;
  isValidated: boolean;
  disclaimer: string;
  version: string;
}

export interface RouteStepDto {
  instruction: string;
  distanceMeters: number;
  nodeId?: string;
  landmark?: string | null;
}

export interface RouteResponseDto {
  distanceMeters: number | null;
  durationMinutes: number | null;
  steps: RouteStepDto[];
  path?: string[];
  from?: { lat: number; lng: number };
  to?: { lat: number; lng: number };
  disclaimer?: string;
}

export interface NearbyPresenceDto {
  userId: string;
  fullName: string;
  avatarSeed: string;
  status: string;
  privacyMode: string;
  location: { lat: number; lng: number } | null;
  approximate: boolean;
  distanceMeters: number | null;
  buildingId: string | null;
  buildingName: string | null;
  isFriend: boolean;
  updatedAt: string;
}

export interface HealthDto {
  status: string;
  service: string;
  version: string;
  database: string;
  postgis: string | null;
  redis: string;
  uptimeSeconds: number;
  timestamp: string;
}

// Schémas locaux (réponses non couvertes par @uac/contracts)
const graphNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  label: z.string().nullable(),
  accessible: z.boolean(),
});

const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  distanceMeters: z.number().positive(),
  accessible: z.boolean(),
  restrictions: z.array(z.string()).nullable(),
  surface: z.string().nullable(),
});

const pedestrianGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  accessibleEdgeCount: z.number().int().nonnegative(),
  isValidated: z.boolean(),
  disclaimer: z.string(),
  version: z.string(),
});

// ---------------------------------------------------------------------------
// Santé
// ---------------------------------------------------------------------------

/**
 * `GET /health` — SEUL endpoint du serveur qui n'utilise PAS l'enveloppe
 * `{data, meta, requestId}` : il renvoie directement `{status, database, ...}`.
 * C'est un endpoint d'infrastructure, pas une ressource métier.
 *
 * On ne peut donc pas passer par `apiFetch` (qui exige la propriété `data`) :
 * on fait un `fetch` direct avec le même timeout, sans jamais inventer de
 * valeur — en cas d'échec, on lève une `ApiError`.
 */
export async function fetchHealth(options?: RequestOptions): Promise<HealthDto> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_URL}/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        `Le service de santé a répondu ${response.status}.`,
        response.status,
      );
    }
    const body = (await response.json()) as HealthDto;
    if (typeof body?.status !== "string") {
      throw new ApiError("INVALID_RESPONSE", "Réponse /health inattendue.", 200);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("NETWORK_ERROR", "Impossible de joindre le serveur.", 0);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Facultés
// ---------------------------------------------------------------------------

export interface FacultyWithCount extends Faculty {
  buildingCount: number;
}

/** `GET /api/v1/faculties` — renvoie un tableau simple (pas de pagination). */
export async function fetchFaculties(options?: RequestOptions): Promise<FacultyWithCount[]> {
  const envelope = await apiFetchValidated<FacultyWithCount[]>(
    "/api/v1/faculties",
    z.array(facultySchema.extend({ buildingCount: z.number().int().nonnegative() })),
    { anonymous: true, ...options },
  );
  return envelope.data;
}

// ---------------------------------------------------------------------------
// Bâtiments
// ---------------------------------------------------------------------------

export interface BuildingsQuery {
  page?: number;
  limit?: number;
  category?: string;
  facultyId?: string;
  search?: string;
  /** "minLng,minLat,maxLng,maxLat" — filtré par PostGIS côté serveur. */
  bbox?: string;
}

export interface BuildingsResult {
  items: Building[];
  meta: PaginationMeta;
  /** Éléments que le contrat n'a pas pu valider. Vide dans le cas normal. */
  rejected: number;
}

export async function fetchBuildings(
  query: BuildingsQuery = {},
  options: RequestOptions = {},
): Promise<BuildingsResult> {
  const qs = queryString({
    page: query.page,
    limit: query.limit,
    category: query.category,
    facultyId: query.facultyId,
    search: query.search,
    bbox: query.bbox,
  });

  // Validation élément par élément : un bâtiment non conforme ne doit pas
  // faire disparaître les 359 autres. C'est ce qui se produisait auparavant.
  const envelope = await apiFetchValidatedList<Building>(
    `/api/v1/buildings${qs}`,
    buildingSchema,
    { anonymous: true, ...options },
  );

  return {
    items: envelope.data,
    meta: envelope.meta ?? {
      page: 1,
      limit: envelope.data.length,
      total: envelope.data.length,
      totalPages: 1,
      hasMore: false,
    },
    rejected: envelope.rejected.length,
  };
}

/** Compteurs globaux : portent sur tout le référentiel, pas sur une page. */
export interface BuildingStatsDto {
  total: number;
  georeferenced: number;
  verification: { verified: number; pending: number; unverified: number };
  withRooms: number;
  byCategory: Array<{ key: string; value: number }>;
  bySource: Array<{ key: string; value: number }>;
}

const buildingStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  georeferenced: z.number().int().nonnegative(),
  verification: z.object({
    verified: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  withRooms: z.number().int().nonnegative(),
  byCategory: z.array(z.object({ key: z.string(), value: z.number().int().nonnegative() })),
  bySource: z.array(z.object({ key: z.string(), value: z.number().int().nonnegative() })),
});

/**
 * `GET /api/v1/buildings/stats` — agrégats calculés par PostgreSQL.
 *
 * Remplace les comptages déduits d'une page de liste. Le tableau de bord
 * annonçait « X géoréférencés » en filtrant `list({ limit: 100 })` : le chiffre
 * était donc calculé sur 100 bâtiments sur 360, et présenté comme s'il portait
 * sur tout le campus.
 */
export async function fetchBuildingStats(
  options: RequestOptions = {},
): Promise<BuildingStatsDto> {
  const envelope = await apiFetchValidated<BuildingStatsDto>(
    "/api/v1/buildings/stats",
    buildingStatsSchema,
    { anonymous: true, ...options },
  );
  return envelope.data;
}

/** Emprise cartographique : sous-ensemble léger de `Building`, sans pagination. */
export interface MapBuildingDto {
  id: string;
  code: string;
  name: string;
  category: Building["category"];
  floors: number;
  footprintAreaM2: number | null;
  geometry: Building["geometry"];
  centroid: Building["centroid"];
  source: Building["source"];
  verificationStatus: Building["verificationStatus"];
  isGeoreferenced: boolean;
}

export interface MapBuildingsResult {
  items: MapBuildingDto[];
  total: number;
  georeferenced: number;
  rejected: number;
}

/**
 * `GET /api/v1/buildings/map` — toutes les emprises, sans pagination.
 *
 * Une carte n'est pas une liste : paginer produit des trous visuels silencieux.
 * Avant cet endpoint, la carte demandait `limit=100` pour 360 bâtiments, donc
 * 255 emprises n'étaient jamais dessinées, sans aucun message.
 */
export async function fetchMapBuildings(
  options: RequestOptions = {},
): Promise<MapBuildingsResult> {
  const envelope = await apiFetchValidatedList<MapBuildingDto>(
    "/api/v1/buildings/map",
    mapBuildingSchema,
    { anonymous: true, ...options },
  );

  const meta = (envelope.meta ?? {}) as { total?: number; georeferenced?: number };

  return {
    items: envelope.data,
    total: meta.total ?? envelope.data.length,
    georeferenced:
      meta.georeferenced ?? envelope.data.filter((b) => b.isGeoreferenced).length,
    rejected: envelope.rejected.length,
  };
}

export async function fetchBuilding(id: string, options?: RequestOptions): Promise<Building> {  const envelope = await apiFetchValidated<Building>(
    `/api/v1/buildings/${id}`,
    buildingSchema,
    { anonymous: true, ...options },
  );
  return envelope.data;
}

/**
 * `GET /api/v1/buildings/:id/rooms`
 *
 * ÉCART DE CONTRAT — RÉSOLU CÔTÉ SERVEUR. Historique pour la traçabilité :
 * `roomSchema` (dans `@uac/contracts`) exige `buildingId` et `createdAt` ; la
 * version précédente de `BuildingsService.roomsOf()` ne les renvoyait pas, et
 * le client rétrécissait donc le contrat avec `roomSchema.omit(...)` pour
 * pouvoir valider la réponse. C'était masquer l'écart : les deux colonnes
 * existent en base (`building_id`, `created_at`), le service les jette
 * simplement.
 *
 * Le service a été corrigé : il sélectionne et renvoie désormais les deux
 * champs. On valide donc avec le contrat COMPLET, sans `.omit()`, et sans
 * jamais fabriquer de valeur. Si un jour le serveur régresse, la validation
 * échouera bruyamment — ce qui est exactement le comportement voulu.
 */
export type RoomDto = Room;

export async function fetchBuildingRooms(
  buildingId: string,
  options?: RequestOptions,
): Promise<RoomDto[]> {
  const envelope = await apiFetchValidated<RoomDto[]>(
    `/api/v1/buildings/${buildingId}/rooms`,
    z.array(roomSchema),
    { anonymous: true, ...options },
  );
  return envelope.data;
}

// ---------------------------------------------------------------------------
// Graphe piéton
// ---------------------------------------------------------------------------

/** `GET /api/v1/navigation/graph?full=1` — nœuds + arêtes complets. */
export async function fetchPedestrianGraph(options?: RequestOptions): Promise<PedestrianGraphDto> {
  const envelope = await apiFetchValidated<PedestrianGraphDto>(
    "/api/v1/navigation/graph?full=1",
    pedestrianGraphSchema,
    { anonymous: true, ...options },
  );
  return envelope.data;
}

export interface GraphMetadataDto {
  nodeCount: number;
  edgeCount: number;
  accessibleEdgeCount: number;
  isValidated: boolean;
  disclaimer: string;
  version: string;
}

export async function fetchGraphMetadata(options?: RequestOptions): Promise<GraphMetadataDto> {
  const envelope = await apiFetch<GraphMetadataDto>("/api/v1/navigation/graph", {
    anonymous: true,
    ...options,
  });
  return envelope.data;
}

export async function requestRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  options?: RequestOptions,
): Promise<RouteResponseDto> {
  const envelope = await apiFetch<RouteResponseDto>("/api/v1/navigation/routes", {
    method: "POST",
    body: { from, to },
    anonymous: true,
    ...options,
  });
  return envelope.data;
}

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

export interface ReportsQuery {
  page?: number;
  limit?: number;
  category?: string;
  status?: string;
  sort?: "recent" | "confirmations" | "severity";
}

export async function fetchReports(
  query: ReportsQuery = {},
  options: RequestOptions = {},
): Promise<{ items: Report[]; meta: PaginationMeta }> {
  const qs = queryString({
    page: query.page,
    limit: query.limit,
    category: query.category,
    status: query.status,
    sort: query.sort,
  });

  const envelope = await apiFetchValidated<Report[]>(
    `/api/v1/reports${qs}`,
    z.array(reportSchema),
    { anonymous: true, ...options },
  );

  return {
    items: envelope.data,
    meta: envelope.meta ?? {
      page: 1,
      limit: envelope.data.length,
      total: envelope.data.length,
      totalPages: 1,
      hasMore: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Présence (authentifiée — ADR-006)
// ---------------------------------------------------------------------------

/**
 * `GET /api/v1/presence/nearby` — EXIGE un jeton.
 *
 * Sans jeton, le serveur renvoie 401 : la proximité n'est jamais anonyme, car
 * l'absence d'observateur identifié rendrait toute règle de confidentialité
 * inapplicable. L'appelant doit donc gérer explicitement le cas « non connecté ».
 */
export async function fetchNearbyPresence(
  params: { lat: number; lng: number; radius?: number; limit?: number },
  options?: RequestOptions,
): Promise<NearbyPresenceDto[]> {
  const qs = queryString({
    lat: params.lat,
    lng: params.lng,
    radius: params.radius,
    limit: params.limit,
  });
  const envelope = await apiFetch<NearbyPresenceDto[]>(`/api/v1/presence/nearby${qs}`, options);
  return envelope.data;
}

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

export interface AuthUserDto {
  id: string;
  email: string;
  fullName: string;
  avatarSeed: string;
  facultyId: string | null;
  facultyName: string | null;
  department: string | null;
  level: string | null;
  role: string;
  karma: number;
  privacyMode: string;
  onboardingCompleted: boolean;
}

export interface LoginResultDto {
  user: AuthUserDto;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: "Bearer" };
}

export async function login(
  email: string,
  password: string,
  options?: RequestOptions,
): Promise<LoginResultDto> {
  const envelope = await apiFetch<LoginResultDto>("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    anonymous: true,
    ...options,
  });
  return envelope.data;
}

export async function fetchMe(options?: RequestOptions): Promise<AuthUserDto> {
  const envelope = await apiFetch<AuthUserDto>("/api/v1/auth/me", options);
  return envelope.data;
}

export type { ApiEnvelope };
