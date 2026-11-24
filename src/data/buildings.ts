import type { Building } from "@/types";

/**
 * REPÈRES DU CAMPUS — coordonnées réellement issues d'OpenStreetMap.
 *
 * Source : OpenStreetMap via Overpass API — licence ODbL-1.0.
 * © OpenStreetMap contributors — https://www.openstreetmap.org/copyright
 *
 * Les 11 premiers repères sont positionnés sur une emprise OSM identifiée
 * (champ `osmId`), en projection UTM 31N ramenée dans le repère local décrit
 * dans `src/data/campus-geo.ts` (1 unité = 1 m, x = est, z = -nord).
 *
 * Les 3 repères restants (`stade`, `infirmerie`, `espace-etudiant`) n'ont
 * AUCUNE emprise dans OSM : leurs `position` sont indicatives, reprises des
 * données historiques du projet, et portent `confidence: "unverified"`.
 * Aucune coordonnée n'a été fabriquée pour ces trois-là.
 *
 * Les champs `occupants`, `capacity`, `rooms` et `amenities` restent des
 * données de DÉMONSTRATION : OSM ne publie pas d'occupation. Ils ne sont
 * jamais présentés comme mesurés (voir `BuildingDrawer`).
 */

export type BuildingConfidence = "osm_footprint" | "unverified";

/** Emprise OSM de référence pour les repères vérifiés. */
export type BuildingGeo = {
  osmId: number;
  areaM2: number;
  heightSource: "osm_height" | "osm_levels" | "estimated";
  /** Nom exact publié par OSM sur cette emprise. */
  osmName: string | null;
};

type Landmark = Building & {
  confidence: BuildingConfidence;
  geo?: BuildingGeo;
};

export const CAMPUS_BUILDINGS: Landmark[] = [
  {
    id: "ifri",
    name: "IFRI — Institut de Formation et de Recherche en Informatique",
    shortName: "IFRI",
    category: "academic",
    // Emprise OSM : « Amphi IRAN/ Administration IFRI » (way 347695349)
    position: { x: -196.2, z: -33.8 },
    footprint: { w: 22.6, d: 30 },
    height: 10.2,
    rotation: -1.509,
    floors: 3,
    description:
      "Cœur du campus numérique : salles de TP, laboratoires réseaux, amphithéâtre et espaces de coworking étudiant.",
    occupants: 36,
    capacity: 420,
    accentIndex: 0,
    openHours: "07:00 — 21:00",
    amenities: ["3 salles de TP", "Labo réseaux", "Wifi fibre", "Espace coworking"],
    rooms: [
      { id: "ifri-a1", name: "Amphi A1", capacity: 180, occupied: true },
      { id: "ifri-tp2", name: "Salle TP 2", capacity: 40, occupied: true },
      { id: "ifri-tp3", name: "Salle TP 3", capacity: 40, occupied: false },
      { id: "ifri-lr", name: "Labo Réseaux", capacity: 24, occupied: true },
      { id: "ifri-cow", name: "Coworking", capacity: 60, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347695349, areaM2: 599.7, heightSource: "estimated", osmName: "Amphi IRAN/ Administration IFRI" },
  },
  {
    id: "fast",
    name: "FAST — Faculté des Sciences et Techniques",
    shortName: "FAST",
    category: "academic",
    // Emprise OSM : « Administration FAST » (way 347661193)
    position: { x: 372.9, z: -203.2 },
    footprint: { w: 56.6, d: 67.2 },
    height: 6.8,
    rotation: 1.081,
    floors: 2,
    description:
      "Sciences fondamentales et appliquées : physique, chimie, biologie, mathématiques et géologie.",
    occupants: 88,
    capacity: 980,
    accentIndex: 1,
    openHours: "07:00 — 20:00",
    amenities: ["4 amphis", "Laboratoires de chimie", "Herbier", "Bibliothèque"],
    rooms: [
      { id: "fast-ph", name: "Amphi Physique", capacity: 240, occupied: true },
      { id: "fast-ch", name: "Amphi Chimie", capacity: 220, occupied: true },
      { id: "fast-bio", name: "Labo Biologie", capacity: 36, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347661193, areaM2: 1706.8, heightSource: "estimated", osmName: "Administration FAST" },
  },
  {
    id: "amphis",
    name: "Amphithéâtres Universitaires",
    shortName: "Amphis",
    category: "amphitheatre",
    // Emprise OSM : « Amphi Idriss Deby » (way 347661202),
    // le plus vaste amphithéâtre du campus (2 242 m²).
    position: { x: -24.2, z: -595.3 },
    footprint: { w: 52.7, d: 83.4 },
    height: 6.8,
    rotation: -1.238,
    floors: 1,
    description:
      "Ensemble d'amphithéâtres partagés pour les cours magistraux de premier cycle.",
    occupants: 142,
    capacity: 1650,
    accentIndex: 2,
    openHours: "07:00 — 19:00",
    amenities: ["3 amphis", "Sono", "Vidéoprojecteurs", "Régie"],
    rooms: [
      { id: "amphi-1000", name: "Amphi 1000", capacity: 1000, occupied: true },
      { id: "amphi-500", name: "Amphi 500", capacity: 500, occupied: true },
      { id: "amphi-300", name: "Amphi 300", capacity: 300, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347661202, areaM2: 2242.4, heightSource: "estimated", osmName: "Amphi Idriss Deby" },
  },
  {
    id: "rectorat",
    name: "Rectorat de l'Université d'Abomey-Calavi",
    shortName: "Rectorat",
    category: "administration",
    // Emprise OSM : « Rectorat » (way 347710612)
    position: { x: 156.2, z: 118.4 },
    footprint: { w: 37.6, d: 16.9 },
    height: 6.8,
    rotation: 0.139,
    floors: 2,
    description:
      "Gouvernance de l'université : cabinet du recteur, secrétariat général, affaires académiques.",
    occupants: 24,
    capacity: 160,
    accentIndex: 3,
    openHours: "07:30 — 17:30",
    amenities: ["Salle du conseil", "Bureau du courrier", "Accueil"],
    rooms: [
      { id: "rect-cab", name: "Cabinet du Recteur", capacity: 12, occupied: true },
      { id: "rect-conseil", name: "Salle du conseil", capacity: 40, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347710612, areaM2: 411.8, heightSource: "estimated", osmName: "Rectorat" },
  },
  {
    id: "admin",
    name: "Administration Universitaire",
    shortName: "Administration",
    category: "administration",
    // Emprise OSM : « Administration EPAC » (way 347710586)
    position: { x: -1.4, z: 185.1 },
    footprint: { w: 51.8, d: 43.1 },
    height: 6.8,
    rotation: 0.146,
    floors: 2,
    description:
      "Services centraux : scolarité, ressources humaines, affaires financières et guichets étudiants.",
    occupants: 58,
    capacity: 340,
    accentIndex: 4,
    openHours: "07:30 — 17:30",
    amenities: ["Guichets 1-6", "Bureau RH", "Archives", "Attente couverte"],
    rooms: [
      { id: "admin-scol", name: "Scolarité centrale", capacity: 30, occupied: true },
      { id: "admin-rh", name: "Bureau RH", capacity: 14, occupied: true },
      { id: "admin-guich", name: "Guichets 1-6", capacity: 60, occupied: true },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347710586, areaM2: 1720.7, heightSource: "estimated", osmName: "Administration EPAC" },
  },
  {
    id: "resto",
    name: "Restaurant Universitaire 1",
    shortName: "Resto U",
    category: "food",
    // Emprise OSM : « Restaurant Universitaire 1 » (way 347335306)
    position: { x: 118.1, z: 226.8 },
    footprint: { w: 66.5, d: 62 },
    height: 6.8,
    rotation: 0.156,
    floors: 2,
    description:
      "Restauration universitaire : service du midi en continu, files d'attente variables selon les horaires.",
    occupants: 210,
    capacity: 600,
    accentIndex: 5,
    openHours: "11:00 — 15:00 · 18:30 — 20:30",
    amenities: ["2 lignes de service", "Espace extérieur", "Point d'eau", "Paiement mobile"],
    rooms: [
      { id: "resto-s1", name: "Ligne de service 1", capacity: 200, occupied: true },
      { id: "resto-s2", name: "Ligne de service 2", capacity: 200, occupied: true },
      { id: "resto-ter", name: "Terrasse", capacity: 200, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347335306, areaM2: 2850.7, heightSource: "estimated", osmName: "Restaurant Universitaire 1" },
  },
  {
    id: "crous",
    name: "Centre des Œuvres Universitaires et Sociales",
    shortName: "COUS",
    category: "service",
    // Emprise OSM : « Administration COUS » (way 347314860)
    position: { x: 247, z: 293.8 },
    footprint: { w: 21.2, d: 24.6 },
    height: 6.8,
    rotation: -0.492,
    floors: 2,
    description:
      "Œuvres sociales : bourses, aides sociales, hébergement et restauration étudiante.",
    occupants: 18,
    capacity: 90,
    accentIndex: 6,
    openHours: "07:30 — 16:30",
    amenities: ["Guichet bourses", "Aide sociale", "Logement"],
    rooms: [
      { id: "cous-b", name: "Guichet bourses", capacity: 20, occupied: true },
      { id: "cous-a", name: "Aide sociale", capacity: 12, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347314860, areaM2: 380, heightSource: "estimated", osmName: "Administration COUS" },
  },
  {
    id: "residences",
    name: "Résidence Universitaire D",
    shortName: "Résidences",
    category: "residence",
    // Emprise OSM : « Résidence D » (way 347314870) — 3 niveaux relevés dans OSM.
    position: { x: 12.1, z: 521.1 },
    footprint: { w: 88.6, d: 60.6 },
    height: 10.2,
    rotation: -0.92,
    floors: 3,
    description:
      "Hébergement étudiant sur le campus : chambres individuelles et partagées, blocs sanitaires communs.",
    occupants: 64,
    capacity: 480,
    accentIndex: 7,
    openHours: "Accès 24 h/24",
    amenities: ["Chambres individuelles", "Blocs sanitaires", "Étude commune", "Laverie"],
    rooms: [
      { id: "res-aile-a", name: "Aile A", capacity: 160, occupied: true },
      { id: "res-aile-b", name: "Aile B", capacity: 160, occupied: true },
      { id: "res-etude", name: "Salle d'étude", capacity: 60, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347314870, areaM2: 1929.1, heightSource: "osm_levels", osmName: "Résidence D" },
  },
  {
    id: "bibliotheque",
    name: "Bibliothèque Centrale de l'UAC",
    shortName: "Bibliothèque",
    category: "library",
    // Emprise OSM : « Bibliothèque Centre de Documentation » (way 347695350)
    position: { x: -106.7, z: 1.7 },
    footprint: { w: 35.3, d: 37.8 },
    height: 6.8,
    rotation: -0.018,
    floors: 2,
    description:
      "Bibliothèque centrale : collections pluridisciplinaires, salles de lecture silencieuse et accès numérique.",
    occupants: 96,
    capacity: 400,
    accentIndex: 8,
    openHours: "08:00 — 20:00",
    amenities: ["2 salles de lecture", "Salle numérique", "Photocopie", "Wifi"],
    rooms: [
      { id: "bibl-lect1", name: "Salle de lecture 1", capacity: 150, occupied: true },
      { id: "bibl-lect2", name: "Salle de lecture 2", capacity: 150, occupied: false },
      { id: "bibl-num", name: "Salle numérique", capacity: 60, occupied: true },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347695350, areaM2: 1054.8, heightSource: "estimated", osmName: "Bibliothèque Centre de Documentation" },
  },
  {
    id: "flsh",
    name: "FLSH — Faculté des Lettres, Langues et Sciences Humaines",
    shortName: "FLSH",
    category: "academic",
    // Emprise OSM : « Administration Flash et Salles de cours » (way 347710578)
    position: { x: 149.5, z: 67.3 },
    footprint: { w: 34.5, d: 36.2 },
    height: 6.8,
    rotation: 0.15,
    floors: 2,
    description:
      "Lettres, langues, arts et sciences humaines : départements de français, anglais, histoire et philosophie.",
    occupants: 74,
    capacity: 860,
    accentIndex: 9,
    openHours: "07:00 — 19:00",
    amenities: ["Salles de cours", "Laboratoire de langues", "Salle de soutenance"],
    rooms: [
      { id: "flsh-a", name: "Salle de cours A", capacity: 70, occupied: true },
      { id: "flsh-lang", name: "Labo de langues", capacity: 30, occupied: true },
      { id: "flsh-sout", name: "Salle de soutenance", capacity: 40, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347710578, areaM2: 640.6, heightSource: "estimated", osmName: "Administration Flash et Salles de cours" },
  },
  {
    id: "fadesp",
    name: "FADESP — Faculté de Droit et de Science Politique",
    shortName: "FADESP",
    category: "academic",
    // Emprise OSM : « Administration Fadesp » (way 347710582)
    position: { x: 9.9, z: 0.5 },
    footprint: { w: 32.8, d: 21.7 },
    height: 6.8,
    rotation: 0.125,
    floors: 2,
    description:
      "Droit et science politique : amphithéâtres de droit, salle de simulation judiciaire, centre de documentation.",
    occupants: 61,
    capacity: 540,
    accentIndex: 10,
    openHours: "07:00 — 19:00",
    amenities: ["Salle de simulation", "Centre de documentation", "Salles de TD"],
    rooms: [
      { id: "fadesp-a", name: "Salle de TD 1", capacity: 50, occupied: true },
      { id: "fadesp-sim", name: "Salle de simulation judiciaire", capacity: 45, occupied: false },
    ],
    confidence: "osm_footprint",
    geo: { osmId: 347710582, areaM2: 567.6, heightSource: "estimated", osmName: "Administration Fadesp" },
  },
  {
    id: "stade",
    name: "Installations sportives",
    shortName: "Stade",
    category: "sports",
    // AUCUNE emprise OSM : coordonnées historiques du projet, non vérifiées.
    position: { x: -168, z: 148 },
    footprint: { w: 110, d: 78 },
    height: 2,
    rotation: 0.04,
    floors: 1,
    description:
      "Installations sportives du campus : terrain de football, piste et terrains de proximité.",
    occupants: 34,
    capacity: 900,
    accentIndex: 11,
    openHours: "06:00 — 19:00",
    amenities: ["Terrain de football", "Piste", "Vestiaires"],
    rooms: [
      { id: "stade-ter", name: "Terrain principal", capacity: 800, occupied: true },
      { id: "stade-vest", name: "Vestiaires", capacity: 60, occupied: false },
    ],
    confidence: "unverified",
  },
  {
    id: "infirmerie",
    name: "Infirmerie universitaire",
    shortName: "Infirmerie",
    category: "service",
    // AUCUNE emprise OSM : coordonnées historiques du projet, non vérifiées.
    position: { x: 208, z: -34 },
    footprint: { w: 24, d: 18 },
    height: 3.4,
    rotation: 0.05,
    floors: 1,
    description:
      "Premiers soins et orientation médicale pour les étudiants et le personnel.",
    occupants: 4,
    capacity: 24,
    accentIndex: 12,
    openHours: "07:30 — 18:00",
    amenities: ["Salle de soins", "Observation", "Pharmacie de dépannage"],
    rooms: [
      { id: "inf-soins", name: "Salle de soins", capacity: 8, occupied: true },
      { id: "inf-obs", name: "Observation", capacity: 4, occupied: false },
    ],
    confidence: "unverified",
  },
  {
    id: "espace-etudiant",
    name: "Espace étudiant",
    shortName: "Espace étudiant",
    category: "service",
    // AUCUNE emprise OSM : coordonnées historiques du projet, non vérifiées.
    position: { x: -64, z: 132 },
    footprint: { w: 30, d: 22 },
    height: 3.4,
    rotation: -0.06,
    floors: 1,
    description:
      "Lieu de vie étudiante : associations, détente entre deux cours, animations et permanences.",
    occupants: 42,
    capacity: 150,
    accentIndex: 13,
    openHours: "08:00 — 22:00",
    amenities: ["Salle associative", "Détente", "Point café"],
    rooms: [
      { id: "espace-asso", name: "Salle associative", capacity: 80, occupied: true },
      { id: "espace-det", name: "Espace détente", capacity: 70, occupied: false },
    ],
    confidence: "unverified",
  },
];

export const BUILDING_BY_ID = new Map(CAMPUS_BUILDINGS.map((b) => [b.id, b]));

/** Repères dont l'emprise provient réellement d'OSM. */
export const VERIFIED_LANDMARKS = CAMPUS_BUILDINGS.filter(
  (b) => b.confidence === "osm_footprint",
);

/** Repères sans emprise OSM — jamais présentés comme localisés. */
export const UNVERIFIED_LANDMARKS = CAMPUS_BUILDINGS.filter(
  (b) => b.confidence === "unverified",
);

export const CATEGORY_META: Record<
  Building["category"],
  { label: string; color: string; icon: string }
> = {
  academic: { label: "Enseignement", color: "#35D6F5", icon: "GraduationCap" },
  administration: { label: "Administration", color: "#8B5CF6", icon: "Building2" },
  amphitheatre: { label: "Amphithéâtre", color: "#A78BFA", icon: "Presentation" },
  library: { label: "Bibliothèque", color: "#22C55E", icon: "BookOpen" },
  food: { label: "Restauration", color: "#F59E0B", icon: "UtensilsCrossed" },
  residence: { label: "Résidence", color: "#F472B6", icon: "Home" },
  sports: { label: "Sport", color: "#38BDF8", icon: "Activity" },
  service: { label: "Service", color: "#FBBF24", icon: "LifeBuoy" },
};
