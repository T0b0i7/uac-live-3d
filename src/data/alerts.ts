import type { AlertCategory, CampusAlert } from "@/types";

const MIN = 60_000;
const HOUR = 60 * MIN;

export const now = () => Date.now();

export const ALERT_META: Record<
  AlertCategory,
  { label: string; color: string; icon: string; tone: "danger" | "warning" | "info" | "success" }
> = {
  "power-outage": { label: "Coupure d'électricité", color: "#F43F5E", icon: "ZapOff", tone: "danger" },
  "power-restored": { label: "Électricité rétablie", color: "#22C55E", icon: "Zap", tone: "success" },
  queue: { label: "File d'attente", color: "#F59E0B", icon: "Users", tone: "warning" },
  "room-change": { label: "Changement de salle", color: "#8B5CF6", icon: "DoorOpen", tone: "info" },
  professor: { label: "Arrivée du professeur", color: "#35D6F5", icon: "UserCheck", tone: "info" },
  event: { label: "Événement", color: "#A78BFA", icon: "CalendarDays", tone: "info" },
  security: { label: "Sécurité", color: "#F43F5E", icon: "ShieldAlert", tone: "danger" },
  infrastructure: { label: "Infrastructure", color: "#FBBF24", icon: "Wrench", tone: "warning" },
};

type AlertSeed = Omit<CampusAlert, "createdAt" | "expiresAt"> & {
  createdAgoMin: number;
  ttlMin: number;
};

const SEEDS: AlertSeed[] = [
  {
    id: "alert-001",
    category: "power-outage",
    title: "Coupure d'électricité — Zone IFRI",
    description:
      "Coupure signalée au niveau du bloc IFRI et de la cour centrale. Les salles de TP 2 et 3 sont impactées. La SBEE a été informée.",
    buildingId: "ifri",
    author: "Rodrigue Hounkpatin",
    authorId: "stu-002",
    confirmations: 24,
    reports: 0,
    status: "active",
    severity: "high",
    comments: [
      { id: "c1", author: "Élodie Bada", text: "Confirmé, plus de courant en TP 2.", createdAt: 0 },
      { id: "c2", author: "Séraphin Ahouansou", text: "On regarde avec le service technique.", createdAt: 0 },
    ],
    createdAgoMin: 8,
    ttlMin: 120,
  },
  {
    id: "alert-002",
    category: "queue",
    title: "Longue file au guichet scolarité",
    description:
      "Plus de 40 étudiants en attente au guichet scolarité centrale. Prévoir 45 minutes minimum.",
    buildingId: "rectorat",
    author: "Kevin Adékambi",
    authorId: "stu-014",
    confirmations: 17,
    reports: 1,
    status: "active",
    severity: "medium",
    comments: [{ id: "c1", author: "Estelle Vodounon", text: "Mieux vaut venir après 14h.", createdAt: 0 }],
    createdAgoMin: 26,
    ttlMin: 180,
  },
  {
    id: "alert-003",
    category: "room-change",
    title: "Changement de salle — Algorithmique avancée",
    description:
      "Le cours de L3 Génie Logiciel est déplacé de la Salle TP 2 vers l'Amphi A1 pour cause de panne d'électricité.",
    buildingId: "ifri",
    author: "Aïcha Sossou",
    authorId: "stu-001",
    confirmations: 31,
    reports: 0,
    status: "active",
    severity: "medium",
    comments: [
      { id: "c1", author: "Lionel Gandaho", text: "Merci pour l'info !", createdAt: 0 },
      { id: "c2", author: "Awa Chabi", text: "On sera là dans 5 minutes.", createdAt: 0 },
    ],
    createdAgoMin: 41,
    ttlMin: 90,
  },
  {
    id: "alert-004",
    category: "professor",
    title: "Professeur arrivé — Amphi Physique",
    description:
      "Le professeur de mécanique quantique est arrivé, appel des étudiants de L3 FAST en cours.",
    buildingId: "fast",
    author: "Hakim Bagri",
    authorId: "stu-016",
    confirmations: 12,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [],
    createdAgoMin: 12,
    ttlMin: 45,
  },
  {
    id: "alert-005",
    category: "infrastructure",
    title: "Route piétonne inondée — derrière la FAST",
    description:
      "Un point d'eau bloque le passage piéton entre la FAST et les résidences après la pluie.",
    buildingId: "residences",
    author: "Prisca Djossou",
    authorId: "stu-023",
    confirmations: 9,
    reports: 0,
    status: "active",
    severity: "medium",
    comments: [{ id: "c1", author: "Wilfried Kpogan", text: "Passage par le côté du stade possible.", createdAt: 0 }],
    createdAgoMin: 64,
    ttlMin: 240,
  },
  {
    id: "alert-006",
    category: "event",
    title: "Hackathon UAC — inscriptions ouvertes",
    description:
      "48 heures de code à l'Espace Vie Étudiante. Équipes de 2 à 4 personnes, thème : solutions locales.",
    buildingId: "espace-etudiant",
    author: "Grâce Ahouandjinou",
    authorId: "stu-003",
    confirmations: 42,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [
      { id: "c1", author: "Yann Tonoukouin", text: "Déjà une équipe de 3, on cherche un back-end.", createdAt: 0 },
    ],
    createdAgoMin: 130,
    ttlMin: 1440,
  },
  {
    id: "alert-007",
    category: "queue",
    title: "Restauration : attente modérée",
    description: "La file du Restaurant Universitaire est fluide — environ 10 minutes d'attente.",
    buildingId: "resto",
    author: "Boris Dossou-Yovo",
    authorId: "stu-004",
    confirmations: 21,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [],
    createdAgoMin: 33,
    ttlMin: 120,
  },
  {
    id: "alert-008",
    category: "security",
    title: "Lampe défectueuse — allée Rectorat",
    description:
      "Deux éclairages publics sont hors service sur l'allée principale menant au Rectorat. Prudence le soir.",
    buildingId: "rectorat",
    author: "Aminata Kéita",
    authorId: "stu-009",
    confirmations: 14,
    reports: 1,
    status: "active",
    severity: "high",
    comments: [{ id: "c1", author: "Kenya Adékambi", text: "Signalé au service sécurité du campus.", createdAt: 0 }],
    createdAgoMin: 95,
    ttlMin: 2880,
  },
  {
    id: "alert-009",
    category: "power-restored",
    title: "Électricité rétablie — Bibliothèque",
    description: "Le courant est revenu à la Bibliothèque Universitaire. Les salles rouvrent normalement.",
    buildingId: "bibliotheque",
    author: "Naïma Gbaguidi",
    authorId: "stu-007",
    confirmations: 18,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [],
    createdAgoMin: 52,
    ttlMin: 180,
  },
  {
    id: "alert-010",
    category: "room-change",
    title: "TD déplacé — Salle 204 FLSH",
    description: "Le TD de stylistique est déplacé en Salle 101 du même bâtiment.",
    buildingId: "flsh",
    author: "Sandra Agbadjagan",
    authorId: "stu-015",
    confirmations: 8,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [],
    createdAgoMin: 78,
    ttlMin: 300,
  },
  {
    id: "alert-011",
    category: "event",
    title: "Match inter-facultés — 16h00",
    description: "Football FSA vs FAST au Complexe Sportif. Venez nombreux soutenir les équipes.",
    buildingId: "stade",
    author: "Mathieu Dègboé",
    authorId: "stu-026",
    confirmations: 36,
    reports: 0,
    status: "active",
    severity: "low",
    comments: [],
    createdAgoMin: 210,
    ttlMin: 600,
  },
  {
    id: "alert-012",
    category: "infrastructure",
    title: "Résolu : fuite d'eau à la COUS-AC",
    description: "La fuite signalée hier devant la COUS-AC a été réparée par la maintenance.",
    buildingId: "crous",
    author: "Wilfried Kpogan",
    authorId: "stu-018",
    confirmations: 11,
    reports: 0,
    status: "resolved",
    severity: "low",
    comments: [],
    createdAgoMin: 320,
    ttlMin: 1440,
  },
  {
    id: "alert-013",
    category: "security",
    title: "Appel à la vigilance — parking Amphis",
    description:
      "Deux vols de casques signalés sur le parking des amphithéâtres. La sécurité renforce les rondes.",
    buildingId: "amphis",
    author: "Chantal N'Djè",
    authorId: "stu-021",
    confirmations: 23,
    reports: 2,
    status: "active",
    severity: "high",
    comments: [
      { id: "c1", author: "Merveille Zinsou", text: "Merci, j'utilise le parking couvert maintenant.", createdAt: 0 },
    ],
    createdAgoMin: 150,
    ttlMin: 2880,
  },
  {
    id: "alert-014",
    category: "infrastructure",
    title: "Wifi instable — Bloc B résidences",
    description: "Le point d'accès du Bloc B redémarre en boucle depuis 30 minutes.",
    buildingId: "residences",
    author: "Prisca Djossou",
    authorId: "stu-023",
    confirmations: 16,
    reports: 0,
    status: "active",
    severity: "medium",
    comments: [],
    createdAgoMin: 44,
    ttlMin: 240,
  },
];

export function buildSeedAlerts(base = now()): CampusAlert[] {
  return SEEDS.map(({ createdAgoMin, ttlMin, ...rest }) => {
    const createdAt = base - createdAgoMin * MIN;
    return {
      ...rest,
      createdAt,
      expiresAt: createdAt + ttlMin * MIN,
      comments: rest.comments.map((c, i) => ({ ...c, createdAt: createdAt + (i + 1) * 4 * MIN })),
    };
  });
}

export const SEED_ALERTS = buildSeedAlerts();

export function relativeTime(ts: number, base = Date.now()): string {
  const diff = Math.max(0, base - ts);
  if (diff < MIN) return "à l'instant";
  if (diff < HOUR) return `il y a ${Math.floor(diff / MIN)} min`;
  if (diff < 24 * HOUR) return `il y a ${Math.floor(diff / HOUR)} h`;
  return `il y a ${Math.floor(diff / (24 * HOUR))} j`;
}

export function remainingTime(expiresAt: number, base = Date.now()): string {
  const diff = expiresAt - base;
  if (diff <= 0) return "expirée";
  const m = Math.floor(diff / MIN);
  if (m < 60) return `expire dans ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `expire dans ${h} h`;
  return `expire dans ${Math.floor(h / 24)} j`;
}
