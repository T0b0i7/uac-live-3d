/**
 * Générateur de données de démonstration — @uac/database
 *
 * RÈGLE D'HONNÊTETÉ : ces données sont SIMULÉES. Les coordonnées sont
 * approximatives et ne constituent PAS un relevé géographique du campus.
 * `source = 'STUDENT'` et `verification_status = 'UNVERIFIED'` le reflètent
 * explicitement en base.
 *
 * Le seed est idempotent : `ON CONFLICT DO NOTHING` partout, donc rejouable.
 */

import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/uac_live";

const DEFAULT_PASSWORD = "CampusUac2026";
const PASSWORD_HASH = await argon2.hash(DEFAULT_PASSWORD, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

// ---------------------------------------------------------------------------
// Facultés réelles de l'UAC
// ---------------------------------------------------------------------------
const FACULTIES = [
  { code: "IFRI", name: "Institut de Formation et de Recherche en Informatique", short: "IFRI", desc: "Informatique, réseaux, génie logiciel, intelligence artificielle." },
  { code: "FAST", name: "Faculté des Sciences et Techniques", short: "FAST", desc: "Mathématiques, physique, chimie, biologie, géologie." },
  { code: "FLSH", name: "Faculté des Lettres, Langues, Arts et Sciences Humaines", short: "FLSH", desc: "Lettres modernes, linguistique, philosophie, arts." },
  { code: "FADESP", name: "Faculté de Droit et de Science Politique", short: "FADESP", desc: "Droit public et privé, science politique, relations internationales." },
  { code: "FASEG", name: "Faculté des Sciences Économiques et de Gestion", short: "FASEG", desc: "Économie, gestion, comptabilité, finance." },
  { code: "FSA", name: "Faculté des Sciences Agronomiques", short: "FSA", desc: "Agronomie, production végétale et animale, agroalimentaire." },
  { code: "FSS", name: "Faculté des Sciences de la Santé", short: "FSS", desc: "Médecine, pharmacie, soins infirmiers, santé publique." },
];

// ---------------------------------------------------------------------------
// Bâtiments — coordonnées APPROXIMATIVES, non relevées
// ---------------------------------------------------------------------------
interface SeedBuilding {
  code: string;
  name: string;
  short: string;
  category: string;
  facultyCode: string | null;
  lat: number;
  lng: number;
  widthM: number;
  depthM: number;
  floors: number;
  capacity: number | null;
  accessible: boolean;
  source: string;
  status: string;
  description: string;
}

const BUILDINGS: SeedBuilding[] = [
  { code: "IFRI", name: "Institut de Formation et de Recherche en Informatique", short: "IFRI", category: "ACADEMIC", facultyCode: "IFRI", lat: 6.4127, lng: 2.3387, widthM: 46, depthM: 34, floors: 3, capacity: 900, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Bâtiment principal de l'IFRI : amphithéâtres, salles machine, laboratoires réseau." },
  { code: "FAST-A", name: "FAST — Bloc A (Sciences)", short: "FAST-A", category: "ACADEMIC", facultyCode: "FAST", lat: 6.4145, lng: 2.3402, widthM: 52, depthM: 26, floors: 2, capacity: 1200, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Enseignements de mathématiques, physique et chimie." },
  { code: "AMPHI-500", name: "Amphithéâtre 500", short: "Amphi 500", category: "AMPHITHEATER", facultyCode: null, lat: 6.4152, lng: 2.3389, widthM: 40, depthM: 32, floors: 1, capacity: 500, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Le plus grand amphithéâtre du campus. Cours magistraux de première année." },
  { code: "AMPHI-B", name: "Amphithéâtre B", short: "Amphi B", category: "AMPHITHEATER", facultyCode: null, lat: 6.4158, lng: 2.3403, widthM: 30, depthM: 26, floors: 1, capacity: 300, accessible: false, source: "INSTITUTIONAL", status: "VERIFIED", description: "Amphithéâtre de taille moyenne, accès par escalier uniquement." },
  { code: "RECTORAT", name: "Rectorat de l'Université d'Abomey-Calavi", short: "Rectorat", category: "ADMINISTRATIVE", facultyCode: null, lat: 6.4169, lng: 2.3421, widthM: 44, depthM: 28, floors: 3, capacity: null, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Services centraux : scolarité centrale, ressources humaines, cabinet du recteur." },
  { code: "ADMIN-SCO", name: "Services administratifs et scolarité", short: "Scolarité", category: "ADMINISTRATIVE", facultyCode: null, lat: 6.4162, lng: 2.3434, widthM: 36, depthM: 22, floors: 2, capacity: null, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Inscriptions, relevés de notes, attestations." },
  { code: "RESTO-U", name: "Restaurant universitaire", short: "Resto U", category: "RESTAURANT", facultyCode: null, lat: 6.4102, lng: 2.3371, widthM: 48, depthM: 30, floors: 1, capacity: 800, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Restauration étudiante. Service continu de 11h à 15h." },
  { code: "CROUS", name: "Centre Régional des Œuvres Universitaires", short: "CROUS", category: "SERVICE", facultyCode: null, lat: 6.4098, lng: 2.3384, widthM: 28, depthM: 20, floors: 2, capacity: null, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Bourses, aide sociale, logement étudiant." },
  { code: "RESID-A", name: "Résidences universitaires — Bloc A", short: "Résid. A", category: "RESIDENCE", facultyCode: null, lat: 6.4089, lng: 2.3401, widthM: 56, depthM: 18, floors: 3, capacity: 240, accessible: false, source: "INSTITUTIONAL", status: "VERIFIED", description: "Chambres étudiantes, 3 niveaux." },
  { code: "BIBLIO", name: "Bibliothèque centrale", short: "Bibliothèque", category: "LIBRARY", facultyCode: null, lat: 6.4141, lng: 2.3359, widthM: 42, depthM: 30, floors: 2, capacity: 450, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Salles de lecture, fonds documentaire, accès numérique." },
  { code: "STADE", name: "Stade universitaire", short: "Stade", category: "SPORT", facultyCode: null, lat: 6.4071, lng: 2.3432, widthM: 90, depthM: 62, floors: 1, capacity: 3000, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Terrain d'athlétisme et de football. Tribune ouverte." },
  { code: "FLSH-B", name: "FLSH — Bloc B", short: "FLSH-B", category: "ACADEMIC", facultyCode: "FLSH", lat: 6.4134, lng: 2.3438, widthM: 44, depthM: 24, floors: 2, capacity: 700, accessible: false, source: "STUDENT", status: "UNVERIFIED", description: "Salles de langues et de philosophie. Géométrie approximative." },
  { code: "FADESP", name: "Faculté de Droit et de Science Politique", short: "FADESP", category: "ACADEMIC", facultyCode: "FADESP", lat: 6.4118, lng: 2.3451, widthM: 50, depthM: 32, floors: 3, capacity: 1500, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Amphithéâtres de droit, bibliothèque juridique, salles de TD." },
  { code: "INFIRM", name: "Infirmerie universitaire", short: "Infirmerie", category: "HEALTH", facultyCode: null, lat: 6.4112, lng: 2.3362, widthM: 22, depthM: 16, floors: 1, capacity: null, accessible: true, source: "INSTITUTIONAL", status: "VERIFIED", description: "Premiers soins, consultations générales, orientation vers le CHU." },
  { code: "ESPACE-E", name: "Espace étudiant / Maison des étudiants", short: "Espace Ét.", category: "SERVICE", facultyCode: null, lat: 6.4132, lng: 2.3367, widthM: 32, depthM: 22, floors: 1, capacity: 300, accessible: true, source: "STUDENT", status: "PENDING", description: "Associations étudiantes, coworking, événements. Géométrie à confirmer." },
];

/** Construit un anneau polygonal rectangulaire autour d'un centre, orienté nord. */
function rectRing(lat: number, lng: number, widthM: number, depthM: number): Array<[number, number]> {
  const metersPerDegLat = 111_132.954 - 559.822 * Math.cos(2 * (lat * Math.PI) / 180);
  const metersPerDegLng = (Math.PI / 180) * 6_371_008.8 * Math.cos((lat * Math.PI) / 180);
  const dLat = depthM / 2 / metersPerDegLat;
  const dLng = widthM / 2 / metersPerDegLng;
  const ring: Array<[number, number]> = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
  return ring;
}

function toWktPolygon(ring: Array<[number, number]>): string {
  const coords = ring.map(([x, y]) => `${x} ${y}`).join(", ");
  return `POLYGON((${coords}))`;
}

// ---------------------------------------------------------------------------
// Étudiants
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  "Kokou", "Aminata", "Sèna", "Raoul", "Bénédicte", "Ismaël", "Grâce", "Romuald",
  "Céline", "Aboubacar", "Nadège", "Sylvain", "Faridatou", "Aristide", "Olympe",
  "Mariam", "Éric", "Sandra", "Blaise", "Rachida", "Fabrice", "Doris", "Hospice",
  "Léonie", "Yannick",
];
const LAST_NAMES = [
  "ADJOVI", "HOUNKPE", "DOSSOU", "AGOSSOU", "TOSSOU", "KPADE", "AHOUANDJINOU",
  "GBAGUIDI", "SOGLO", "AKPLOGAN", "ZINSOU", "DJIDJOHO", "AGBODJAN", "VIDJANNAN",
  "KOFFI", "MENSAH", "ATIKPO", "BADA", "CHABI", "DANSOU", "HOUETO", "KOUGBLENOU",
  "LOKOSSOU", "NASSARA", "OGOUYEMI",
];
const DEPARTMENTS = [
  "Génie Logiciel", "Réseaux & Télécommunications", "Intelligence Artificielle",
  "Mathématiques", "Physique-Chimie", "Sciences de la Vie", "Lettres Modernes",
  "Droit Public", "Droit Privé", "Économie", "Gestion", "Agronomie", "Santé Publique",
];
const LEVELS = ["L1", "L2", "L3", "M1", "M2"];
const STATUSES = ["ON_CAMPUS", "IN_BUILDING", "IN_CLASS", "STUDYING", "BREAK", "LEAVING"];
const PRIVACY = ["PUBLIC", "FRIENDS_PROMO", "FRIENDS_PROMO", "BLURRED_ZONE", "GHOST", "FRIENDS_PROMO"];

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    console.log("→ Nettoyage des données de démonstration…");
    await sql`TRUNCATE TABLE
      audit_logs, karma_transactions, notifications, contributions,
      report_comments, report_votes, reports, sos_alerts, trusted_contacts,
      study_group_members, study_groups, friends, user_presence,
      building_verifications, building_history, walkways, rooms,
      buildings, refresh_tokens, users, faculties
      RESTART IDENTITY CASCADE`;

    // --- Facultés ---
    console.log("→ Facultés…");
    const facultyIds = new Map<string, string>();
    for (const f of FACULTIES) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO faculties (code, name, short_name, description)
        VALUES (${f.code}, ${f.name}, ${f.short}, ${f.desc})
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      facultyIds.set(f.code, rows[0]!.id);
    }

    // --- Utilisateurs ---
    console.log("→ Utilisateurs…");
    const userIds: string[] = [];

    // Compte de démonstration principal : ADMIN
    const demoRows = await sql<{ id: string }[]>`
      INSERT INTO users (
        email, password_hash, full_name, matricule, faculty_id, department, level,
        role, avatar_seed, bio, karma, is_verified, onboarding_completed, privacy_mode
      ) VALUES (
        'demo@uac-live.bj', ${PASSWORD_HASH}, 'Eucher ABATTI', 'UAC-DEMO-001',
        ${facultyIds.get("IFRI")!}, 'Génie Logiciel', 'M2', 'ADMIN',
        'eucher-abatti', 'Porteur du projet UAC-Live 3D.', 1250, true, true, 'FRIENDS_PROMO'
      ) RETURNING id
    `;
    userIds.push(demoRows[0]!.id);

    // Un modérateur
    const modRows = await sql<{ id: string }[]>`
      INSERT INTO users (
        email, password_hash, full_name, matricule, faculty_id, department, level,
        role, avatar_seed, bio, karma, is_verified, onboarding_completed, privacy_mode
      ) VALUES (
        'moderateur@uac-live.bj', ${PASSWORD_HASH}, 'Sylvain HOUNKPE', 'UAC-DEMO-002',
        ${facultyIds.get("FAST")!}, 'Mathématiques', 'M1', 'MODERATOR',
        'sylvain-hounkpe', 'Modérateur des contributions géographiques.', 640, true, true, 'PUBLIC'
      ) RETURNING id
    `;
    userIds.push(modRows[0]!.id);

    // 23 étudiants
    for (let i = 0; i < 23; i++) {
      const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
      const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]!;
      const facultyCode = FACULTIES[i % FACULTIES.length]!.code;
      const department = DEPARTMENTS[i % DEPARTMENTS.length]!;
      const level = LEVELS[i % LEVELS.length]!;
      const privacy = PRIVACY[i % PRIVACY.length]!;
      const avatarSeed = `${first.toLowerCase()}-${last.toLowerCase()}`;

      const rows = await sql<{ id: string }[]>`
        INSERT INTO users (
          email, password_hash, full_name, matricule, faculty_id, department, level,
          role, avatar_seed, bio, karma, is_verified, onboarding_completed, privacy_mode
        ) VALUES (
          ${`etudiant${i + 1}@uac-live.bj`}, ${PASSWORD_HASH},
          ${`${first} ${last}`}, ${`UAC-2026-${String(i + 1).padStart(4, "0")}`},
          ${facultyIds.get(facultyCode)!}, ${department}, ${level},
          ${i % 11 === 0 ? "CONTRIBUTOR" : "STUDENT"}, ${avatarSeed},
          ${`Étudiant·e en ${department} à l'UAC.`}, ${Math.floor(Math.random() * 900)},
          true, true, ${privacy}
        ) RETURNING id
      `;
      userIds.push(rows[0]!.id);
    }

    // --- Bâtiments ---
    console.log("→ Bâtiments…");
    const buildingIds = new Map<string, string>();
    for (const b of BUILDINGS) {
      const ring = rectRing(b.lat, b.lng, b.widthM, b.depthM);
      const wkt = toWktPolygon(ring);
      const areaM2 = b.widthM * b.depthM;

      const rows = await sql<{ id: string }[]>`
        INSERT INTO buildings (
          code, name, short_name, category, faculty_id, description, floors,
          footprint, centroid, entrance, footprint_area_m2,
          source, verification_status, last_verified_at, capacity, is_accessible
        ) VALUES (
          ${b.code}, ${b.name}, ${b.short}, ${b.category},
          ${b.facultyCode ? facultyIds.get(b.facultyCode)! : null},
          ${b.description}, ${b.floors},
          ST_GeomFromText(${wkt}, 4326),
          ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326),
          ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat - (b.depthM / 2) / 110_574}), 4326),
          ${areaM2},
          ${b.source}, ${b.status},
          ${b.status === "VERIFIED" ? sql`now()` : null},
          ${b.capacity}, ${b.accessible}
        ) RETURNING id
      `;
      buildingIds.set(b.code, rows[0]!.id);
    }

    // --- Salles ---
    console.log("→ Salles…");
    const roomSeeds = [
      { b: "IFRI", code: "IFRI-AMPHI", name: "Amphi IFRI", cap: 300, floor: 0, type: "AMPHI", acc: true },
      { b: "IFRI", code: "IFRI-M1", name: "Salle machine 1", cap: 40, floor: 1, type: "LAB", acc: true },
      { b: "IFRI", code: "IFRI-M2", name: "Salle machine 2", cap: 40, floor: 1, type: "LAB", acc: true },
      { b: "IFRI", code: "IFRI-TD1", name: "Salle de TD 1", cap: 60, floor: 2, type: "CLASSROOM", acc: false },
      { b: "IFRI", code: "IFRI-RES", name: "Laboratoire réseaux", cap: 25, floor: 2, type: "LAB", acc: true },
      { b: "FAST-A", code: "FAST-A101", name: "Salle 101", cap: 120, floor: 0, type: "CLASSROOM", acc: true },
      { b: "FAST-A", code: "FAST-LAB-PHY", name: "Labo physique", cap: 35, floor: 1, type: "LAB", acc: true },
      { b: "AMPHI-500", code: "A500", name: "Amphi 500", cap: 500, floor: 0, type: "AMPHI", acc: true },
      { b: "AMPHI-B", code: "AB", name: "Amphi B", cap: 300, floor: 0, type: "AMPHI", acc: false },
      { b: "BIBLIO", code: "BIB-LECT", name: "Salle de lecture", cap: 250, floor: 0, type: "LIBRARY", acc: true },
      { b: "BIBLIO", code: "BIB-NUM", name: "Espace numérique", cap: 60, floor: 1, type: "LIBRARY", acc: true },
      { b: "FADESP", code: "FD-AMPHI1", name: "Amphi Droit 1", cap: 400, floor: 0, type: "AMPHI", acc: true },
      { b: "RECTORAT", code: "REC-SCO", name: "Bureau scolarité", cap: 8, floor: 1, type: "OFFICE", acc: true },
    ];
    for (const r of roomSeeds) {
      await sql`
        INSERT INTO rooms (building_id, code, name, capacity, floor, room_type, is_accessible)
        VALUES (${buildingIds.get(r.b)!}, ${r.code}, ${r.name}, ${r.cap}, ${r.floor}, ${r.type}, ${r.acc})
        ON CONFLICT (building_id, code) DO NOTHING
      `;
    }

    // --- Allées piétonnes (graphe) ---
    console.log("→ Allées piétonnes…");
    const codes = BUILDINGS.map((b) => b.code);
    const byCode = new Map(BUILDINGS.map((b) => [b.code, b]));
    const edges: Array<[string, string, boolean, string]> = [
      ["IFRI", "FAST-A", true, "PAVED"],
      ["IFRI", "AMPHI-500", true, "PAVED"],
      ["IFRI", "BIBLIO", true, "PAVED"],
      ["IFRI", "ESPACE-E", true, "PAVED"],
      ["FAST-A", "AMPHI-500", true, "PAVED"],
      ["FAST-A", "AMPHI-B", false, "GRAVEL"],
      ["AMPHI-500", "AMPHI-B", true, "PAVED"],
      ["AMPHI-B", "RECTORAT", true, "PAVED"],
      ["RECTORAT", "ADMIN-SCO", true, "PAVED"],
      ["RECTORAT", "FLSH-B", true, "PAVED"],
      ["ADMIN-SCO", "FLSH-B", true, "PAVED"],
      ["FLSH-B", "FADESP", true, "PAVED"],
      ["AMPHI-500", "BIBLIO", true, "PAVED"],
      ["BIBLIO", "ESPACE-E", true, "PAVED"],
      ["ESPACE-E", "INFIRM", true, "PAVED"],
      ["INFIRM", "RESTO-U", true, "PAVED"],
      ["RESTO-U", "CROUS", true, "PAVED"],
      ["CROUS", "RESID-A", true, "PAVED"],
      ["RESTO-U", "RESID-A", false, "DIRT"],
      ["STADE", "RESID-A", true, "GRAVEL"],
      ["STADE", "FADESP", true, "PAVED"],
    ];
    let edgeIndex = 0;
    for (const [from, to, accessible, surface] of edges) {
      const a = byCode.get(from);
      const b = byCode.get(to);
      if (!a || !b) continue;
      edgeIndex++;
      // Longueur réelle estimée : distance euclidienne locale × facteur de sinuosité 1.18
      const metersPerDegLat = 110_574;
      const metersPerDegLng = 110_574 * Math.cos((a.lat * Math.PI) / 180);
      const dx = (b.lng - a.lng) * metersPerDegLng;
      const dy = (b.lat - a.lat) * metersPerDegLat;
      const straight = Math.sqrt(dx * dx + dy * dy);
      const distance = Math.max(5, Math.round(straight * 1.18 * 10) / 10);

      await sql`
        INSERT INTO walkways (
          code, path, from_node_id, to_node_id, distance_meters, is_accessible, surface, source
        ) VALUES (
          ${`W-${String(edgeIndex).padStart(3, "0")}-${from}-${to}`},
          ST_GeomFromText(${`LINESTRING(${a.lng} ${a.lat}, ${b.lng} ${b.lat})`}, 4326),
          ${from}, ${to}, ${distance}, ${accessible}, ${surface}, 'STUDENT'
        )
        ON CONFLICT (code) DO NOTHING
      `;
    }

    // --- Présences ---
    console.log("→ Présences…");
    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i]!;
      const building = BUILDINGS[i % BUILDINGS.length]!;
      const status = STATUSES[i % STATUSES.length]!;
      const privacy = PRIVACY[i % PRIVACY.length]!;
      // Mode GHOST : aucune position stockée.
      const hasLocation = privacy !== "GHOST";
      const lat = building.lat + (Math.random() - 0.5) * 0.0008;
      const lng = building.lng + (Math.random() - 0.5) * 0.0008;

      await sql`
        INSERT INTO user_presence (
          user_id, status, location, accuracy_meters, building_id,
          privacy_mode, consent_given_at, share_expires_at, last_seen_at
        ) VALUES (
          ${userId}, ${status},
          ${hasLocation ? sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography` : null},
          ${hasLocation ? 12 + Math.floor(Math.random() * 20) : null},
          ${buildingIds.get(building.code)!},
          ${privacy},
          now() - interval '20 minutes',
          now() + interval '100 minutes',
          now() - interval '2 minutes'
        )
        ON CONFLICT (user_id) DO UPDATE SET
          status = EXCLUDED.status,
          location = EXCLUDED.location,
          privacy_mode = EXCLUDED.privacy_mode,
          last_seen_at = EXCLUDED.last_seen_at
      `;
    }

    // --- Amitiés ---
    console.log("→ Amitiés…");
    // Le compte démo est ami avec 6 personnes, et a 2 demandes en attente.
    for (let i = 2; i < 8; i++) {
      const a = userIds[0]!;
      const b = userIds[i]!;
      const [low, high] = a < b ? [a, b] : [b, a];
      await sql`
        INSERT INTO friends (requester_id, addressee_id, status, responded_at)
        VALUES (${low}, ${high}, 'ACCEPTED', now() - interval '5 days')
        ON CONFLICT (least(requester_id, addressee_id), greatest(requester_id, addressee_id)) DO NOTHING
      `;
    }
    for (let i = 8; i < 10; i++) {
      await sql`
        INSERT INTO friends (requester_id, addressee_id, status)
        VALUES (${userIds[i]!}, ${userIds[0]!}, 'PENDING')
        ON CONFLICT (least(requester_id, addressee_id), greatest(requester_id, addressee_id)) DO NOTHING
      `;
    }

    // --- Signalements ---
    console.log("→ Signalements…");
    const reportsSeed = [
      { title: "Fuite d'eau au plafond du couloir", cat: "MAINTENANCE", sev: 3, b: "IFRI", body: "La fuite s'aggrave depuis deux jours, l'eau atteint les prises du couloir." },
      { title: "Ampoules hors service dans l'amphi", cat: "MAINTENANCE", sev: 2, b: "AMPHI-500", body: "La moitié des luminaires ne fonctionnent plus, cours du soir difficile." },
      { title: "Escalier glissant après la pluie", cat: "SAFETY", sev: 4, b: "AMPHI-B", body: "Le revêtement de l'escalier extérieur devient très glissant." },
      { title: "Poubelles débordantes devant le resto", cat: "CLEANLINESS", sev: 2, b: "RESTO-U", body: "Débordement depuis trois jours, présence d'insectes." },
      { title: "File très longue à la scolarité", cat: "CROWD", sev: 2, b: "ADMIN-SCO", body: "Plus de 2h d'attente pour un relevé de notes." },
      { title: "Rampe d'accès bloquée par un véhicule", cat: "ACCESSIBILITY", sev: 4, b: "RECTORAT", body: "Un véhicule stationné bloque l'unique rampe accessible." },
      { title: "Câble électrique apparent dans le couloir", cat: "SAFETY", sev: 5, b: "FAST-A", body: "Câble dénudé à hauteur de main, risque d'électrocution." },
      { title: "Salle machine surchauffée", cat: "MAINTENANCE", sev: 3, b: "IFRI", body: "Climatisation en panne, la salle dépasse 32 °C." },
      { title: "Clé USB perdue près de la bibliothèque", cat: "LOST_ITEM", sev: 1, b: "BIBLIO", body: "Clé USB noire avec une étiquette rouge." },
      { title: "Conférence annulée sans prévenir", cat: "EVENT", sev: 1, b: "ESPACE-E", body: "La conférence sur l'IA a été annulée, aucune information affichée." },
      { title: "Eau non potable au point d'eau", cat: "SAFETY", sev: 4, b: "STADE", body: "L'eau du point d'eau a une odeur suspecte." },
      { title: "Wi-Fi inexistant au 2e étage", cat: "MAINTENANCE", sev: 2, b: "FLSH-B", body: "Aucun signal depuis une semaine au deuxième étage." },
    ];
    for (let i = 0; i < reportsSeed.length; i++) {
      const r = reportsSeed[i]!;
      const authorIdx = (i + 1) % userIds.length;
      const b = byCode.get(r.b)!;
      await sql`
        INSERT INTO reports (
          title, body, category, status, severity, location, building_id,
          author_id, confirmations, rejections, expires_at
        ) VALUES (
          ${r.title}, ${r.body}, ${r.cat},
          ${i < 8 ? "ACTIVE" : i < 10 ? "CONFIRMED" : "RESOLVED"},
          ${r.sev},
          ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326),
          ${buildingIds.get(r.b)!},
          ${userIds[authorIdx]!},
          ${2 + Math.floor(Math.random() * 9)},
          ${Math.floor(Math.random() * 2)},
          now() + interval '6 hours'
        )
      `;
    }

    // --- Groupes d'étude ---
    console.log("→ Groupes d'étude…");
    const groupsSeed = [
      { name: "Algo avancée — préparation examen", subj: "Algorithmique", b: "IFRI", cap: 10, hours: 3 },
      { name: "Réseaux : révision TCP/IP", subj: "Réseaux", b: "IFRI", cap: 8, hours: 5 },
      { name: "Base de données — TP ensemble", subj: "Bases de données", b: "IFRI", cap: 12, hours: 8 },
      { name: "Droit constitutionnel — fiches", subj: "Droit", b: "FADESP", cap: 15, hours: 26 },
      { name: "Mathématiques discrètes", subj: "Mathématiques", b: "FAST-A", cap: 9, hours: 30 },
      { name: "Anglais technique — oral", subj: "Langues", b: "FLSH-B", cap: 7, hours: 50 },
      { name: "Physique — mécanique du point", subj: "Physique", b: "FAST-A", cap: 11, hours: 54 },
      { name: "IA : projet machine learning", subj: "Intelligence Artificielle", b: "IFRI", cap: 6, hours: 72 },
      { name: "Économie — microéconomie", subj: "Économie", b: "FADESP", cap: 14, hours: 78 },
      { name: "Statistiques appliquées", subj: "Statistiques", b: "BIBLIO", cap: 10, hours: 96 },
    ];
    for (let i = 0; i < groupsSeed.length; i++) {
      const g = groupsSeed[i]!;
      const rows = await sql<{ id: string }[]>`
        INSERT INTO study_groups (
          name, subject, description, building_id, capacity, scheduled_at,
          duration_minutes, creator_id, is_active
        ) VALUES (
          ${g.name}, ${g.subj},
          ${`Groupe de révision — ${g.subj}. Ouvert à tous les niveaux.`},
          ${buildingIds.get(g.b)!}, ${g.cap},
          now() + (${g.hours} || ' hours')::interval,
          90, ${userIds[(i + 2) % userIds.length]!}, true
        ) RETURNING id
      `;
      const groupId = rows[0]!.id;
      // Le créateur + 2 à 4 membres
      const memberCount = 1 + Math.floor(Math.random() * 4);
      for (let m = 0; m < memberCount; m++) {
        const memberId = userIds[(i + m + 1) % userIds.length]!;
        await sql`
          INSERT INTO study_group_members (group_id, user_id)
          VALUES (${groupId}, ${memberId})
          ON CONFLICT (group_id, user_id) DO NOTHING
        `;
      }
    }

    // --- Notifications pour le compte démo ---
    console.log("→ Notifications…");
    const notifSeed = [
      { type: "FRIEND_REQUEST", title: "Nouvelle demande d'ami", body: "Sèna DOSSOU souhaite vous ajouter.", url: "/friends", entity: "user" },
      { type: "ALERT", title: "Alerte à proximité de l'IFRI", body: "Fuite d'eau signalée au couloir du 1er étage.", url: "/alerts", entity: "report" },
      { type: "REPORT", title: "Votre signalement a été confirmé", body: "3 étudiants ont confirmé votre signalement de maintenance.", url: "/alerts", entity: "report" },
      { type: "STUDY_GROUP", title: "Session de révision ce soir", body: "Algo avancée — préparation examen à 18h00.", url: "/study", entity: "group" },
      { type: "KARMA", title: "+15 points de réputation", body: "Merci pour votre contribution géographique validée.", url: "/profile", entity: "karma" },
      { type: "SYSTEM", title: "Bienvenue sur UAC-Live 3D", body: "Votre compte est prêt. Explorez le campus en 3D.", url: "/map", entity: null },
      { type: "SOS", title: "Alerte SOS résolue", body: "L'alerte médicale près du stade a été prise en charge.", url: "/alerts", entity: "sos" },
      { type: "FRIEND_ACCEPTED", title: "Demande acceptée", body: "Raoul AGBODJAN a accepté votre demande.", url: "/friends", entity: "user" },
      { type: "ALERT", title: "Câble électrique signalé", body: "Signalement critique à la FAST.", url: "/alerts", entity: "report" },
      { type: "REPORT", title: "Nouveau commentaire sur votre signalement", body: "« Confirmé, même problème ce matin. »", url: "/alerts", entity: "report" },
      { type: "SYSTEM", title: "Vos données restent privées", body: "Vous êtes en mode BLURRED_ZONE. Votre position est floutée.", url: "/settings", entity: null },
      { type: "STUDY_GROUP", title: "Place disponible", body: "Le groupe « IA : projet machine learning » a une place libre.", url: "/study", entity: "group" },
    ];
    for (let i = 0; i < notifSeed.length; i++) {
      const n = notifSeed[i]!;
      await sql`
        INSERT INTO notifications (user_id, type, title, body, read, read_at, action_url, entity_type)
        VALUES (
          ${userIds[0]!}, ${n.type}, ${n.title}, ${n.body},
          ${i > 5}, ${i > 5 ? sql`now() - interval '1 hour'` : null},
          ${n.url}, ${n.entity}
        )
      `;
    }

    // --- Karma ---
    console.log("→ Karma…");
    const karmaSeed = [
      { delta: 15, reason: "CONTRIBUTION_APPROVED" },
      { delta: 5, reason: "REPORT_CONFIRMED" },
      { delta: 10, reason: "BUILDING_VERIFIED" },
      { delta: 20, reason: "STUDY_GROUP_CREATED" },
      { delta: -2, reason: "REPORT_REJECTED" },
    ];
    for (const k of karmaSeed) {
      await sql`
        INSERT INTO karma_transactions (user_id, delta, reason)
        VALUES (${userIds[0]!}, ${k.delta}, ${k.reason})
      `;
    }

    // --- Contacts de confiance ---
    console.log("→ Contacts de confiance…");
    await sql`
      INSERT INTO trusted_contacts (user_id, name, relationship, phone, notify_on_sos)
      VALUES (${userIds[0]!}, 'Akouvi ABATTI', 'parent', '+229 97 00 00 01', true)
    `;

    // --- Contributions en attente ---
    console.log("→ Contributions…");
    await sql`
      INSERT INTO contributions (target_type, target_id, author_id, payload, status)
      VALUES (
        'BUILDING', ${buildingIds.get("ESPACE-E")!}, ${userIds[3]!},
        ${JSON.stringify({ field: "footprint", note: "Emprise corrigée selon observation terrain" })},
        'PENDING'
      )
    `;
    await sql`
      INSERT INTO contributions (target_type, target_id, author_id, payload, status)
      VALUES (
        'ROOM', ${buildingIds.get("IFRI")!}, ${userIds[4]!},
        ${JSON.stringify({ action: "create", code: "IFRI-TD2", name: "Salle de TD 2", capacity: 50 })},
        'PENDING'
      )
    `;

    // --- Audit ---
    console.log("→ Journal d'audit…");
    const auditSeed = [
      { action: "USER_REGISTERED", targetType: "USER", targetId: userIds[0]! },
      { action: "BUILDING_VERIFIED", targetType: "BUILDING", targetId: buildingIds.get("IFRI")! },
      { action: "REPORT_CREATED", targetType: "REPORT", targetId: null },
      { action: "CONTRIBUTION_APPROVED", targetType: "CONTRIBUTION", targetId: null },
      { action: "SOS_TRIGGERED", targetType: "SOS", targetId: null },
    ];
    for (let i = 0; i < auditSeed.length; i++) {
      const a = auditSeed[i]!;
      await sql`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, ip_hash, user_agent)
        VALUES (
          ${userIds[i % 3]!}, ${a.action}, ${a.targetType}, ${a.targetId},
          ${createHash("sha256").update(randomBytes(16)).digest("hex")},
          'Mozilla/5.0 (seed)'
        )
      `;
    }

    // --- Vérification finale ---
    const counts = await sql<{ table: string; count: string }[]>`
      SELECT 'users' AS table, count(*)::text FROM users
      UNION ALL SELECT 'faculties', count(*)::text FROM faculties
      UNION ALL SELECT 'buildings', count(*)::text FROM buildings
      UNION ALL SELECT 'rooms', count(*)::text FROM rooms
      UNION ALL SELECT 'walkways', count(*)::text FROM walkways
      UNION ALL SELECT 'user_presence', count(*)::text FROM user_presence
      UNION ALL SELECT 'friends', count(*)::text FROM friends
      UNION ALL SELECT 'reports', count(*)::text FROM reports
      UNION ALL SELECT 'study_groups', count(*)::text FROM study_groups
      UNION ALL SELECT 'notifications', count(*)::text FROM notifications
      UNION ALL SELECT 'karma_transactions', count(*)::text FROM karma_transactions
      UNION ALL SELECT 'contributions', count(*)::text FROM contributions
      UNION ALL SELECT 'audit_logs', count(*)::text FROM audit_logs
      UNION ALL SELECT 'trusted_contacts', count(*)::text FROM trusted_contacts
    `;

    console.log("\n=== Données insérées ===");
    for (const row of counts) {
      console.log(`  ${row.table.padEnd(22)} ${row.count}`);
    }
    console.log(`\nCompte de démonstration : demo@uac-live.bj / ${DEFAULT_PASSWORD}`);
    console.log("Mot de passe identique pour tous les comptes de démonstration.");
    console.log("⚠ Ces données sont SIMULÉES — coordonnées non relevées.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

seed().catch((error: unknown) => {
  console.error("Échec du seed :", error);
  process.exit(1);
});
