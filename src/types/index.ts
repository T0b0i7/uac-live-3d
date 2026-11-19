export type Vec2 = { x: number; z: number };

export type BuildingCategory =
  | "academic"
  | "administration"
  | "amphitheatre"
  | "library"
  | "food"
  | "residence"
  | "sports"
  | "service";

export type Room = {
  id: string;
  name: string;
  capacity: number;
  occupied?: boolean;
};

export type Building = {
  id: string;
  name: string;
  shortName: string;
  category: BuildingCategory;
  /** Demo coordinates — NOT surveyed. Placeholder until verified OSM data is integrated. */
  position: Vec2;
  /** Footprint in demo metres (procedural geometry only). */
  footprint: { w: number; d: number };
  height: number;
  rotation?: number;
  floors: number;
  description: string;
  occupants: number;
  capacity: number;
  rooms: Room[];
  amenities: string[];
  openHours: string;
  /** Index into the campus palette for procedural roofs/trim. */
  accentIndex: number;
};

export type ActivityStatus =
  | "in-class"
  | "studying"
  | "on-break"
  | "available"
  | "busy";

export type PrivacyMode = "open" | "friends" | "zone" | "ghost";

export type Student = {
  id: string;
  fullName: string;
  initials: string;
  matricule: string;
  faculty: string;
  department: string;
  level: string;
  status: ActivityStatus;
  activity: string;
  buildingId: string;
  bio: string;
  reputation: number;
  contributions: number;
  privacy: PrivacyMode;
  isFriend: boolean;
  requestPending?: boolean;
  mutualFriends?: number;
  online: boolean;
  /** Normalised demo radar coordinate (0..1) used by the 2D radar + 3D avatars. */
  radar: { x: number; y: number };
  /** Unsplash-style seed used to render a deterministic gradient avatar. */
  avatarSeed: string;
};

export type AlertCategory =
  | "power-outage"
  | "power-restored"
  | "queue"
  | "room-change"
  | "professor"
  | "event"
  | "security"
  | "infrastructure";

export type CampusAlert = {
  id: string;
  category: AlertCategory;
  title: string;
  description: string;
  buildingId: string;
  author: string;
  authorId: string;
  createdAt: number;
  expiresAt: number;
  confirmations: number;
  reports: number;
  status: "active" | "resolved" | "expired";
  severity: "low" | "medium" | "high";
  comments: { id: string; author: string; text: string; createdAt: number }[];
};

export type StudyGroup = {
  id: string;
  subject: string;
  topic: string;
  buildingId: string;
  room: string;
  organizer: string;
  organizerId: string;
  participants: number;
  capacity: number;
  startTime: number;
  durationMin: number;
  status: "open" | "full" | "ongoing";
  tags: string[];
  level: string;
  department: string;
  joined?: boolean;
};

export type NotificationType =
  | "friend-request"
  | "group-invite"
  | "campus-alert"
  | "navigation"
  | "confirmation";

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  href?: string;
  actor?: string;
};

export type FriendRequest = {
  id: string;
  studentId: string;
  message: string;
  createdAt: number;
};

export type RouteStep = {
  instruction: string;
  distanceM: number;
  icon: "start" | "straight" | "left" | "right" | "destination";
};

export type PedestrianRoute = {
  id: string;
  fromBuildingId: string;
  toBuildingId: string;
  points: Vec2[];
  distanceM: number;
  durationMin: number;
  steps: RouteStep[];
};

export type CampusEvent = {
  id: string;
  kind: string;
  buildingId?: string;
  message: string;
  at: number;
};

export type User = {
  id: string;
  fullName: string;
  matricule: string;
  email: string;
  faculty: string;
  department: string;
  level: string;
  bio: string;
  avatarSeed: string;
  privacy: PrivacyMode;
  currentBuildingId: string;
  createdAt: number;
};

export type Settings = {
  theme: "dark" | "light";
  reducedMotion: boolean;
  batterySaver: boolean;
  auto2DFallback: boolean;
  mapQuality: "low" | "medium" | "high";
  showAvatars: boolean;
  showLabels: boolean;
  alertsRadius: number;
  notifications: {
    friendRequests: boolean;
    studyInvites: boolean;
    campusAlerts: boolean;
    navigation: boolean;
  };
  language: "fr" | "en";
};
