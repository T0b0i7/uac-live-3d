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

  const envelope = await apiFetchValidated<Building[]>(
    `/api/v1/buildings${qs}`,
    z.array(buildingSchema),
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

export async function fetchBuilding(id: string, options?: RequestOptions): Promise<Building> {
  const envelope = await apiFetchValidated<Building>(
    `/api/v1/buildings/${id}`,
    buildingSchema,
    { anonymous: true, ...options },
  );
  return envelope.data;
}

/**
 * `GET /api/v1/buildings/:id/rooms`
 *
 * ÉCART DE CONTRAT CONSTATÉ (mesuré via curl le 20/11) : `roomSchema` dans
 * `@uac/contracts` exige `buildingId` et `createdAt`, mais
 * `BuildingsService.roomsOf()` ne les sélectionne pas. Valider avec
 * `roomSchema` ferait donc échouer chaque appel à l'exécution.
 *
 * Choix assumé : on valide la forme RÉELLE renvoyée, sans fabriquer les deux
 * champs manquants. Le jour où le service les exposera, il suffira de revenir à
 * `roomSchema` — aucun autre code ne change.
 */
const roomDtoSchema = roomSchema.omit({ buildingId: true, createdAt: true });

export type RoomDto = z.infer<typeof roomDtoSchema>;

export async function fetchBuildingRooms(
  buildingId: string,
  options?: RequestOptions,
): Promise<RoomDto[]> {
  const envelope = await apiFetchValidated<RoomDto[]>(
    `/api/v1/buildings/${buildingId}/rooms`,
    z.array(roomDtoSchema),
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
