"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { BUILDING_BY_ID, CAMPUS_BUILDINGS } from "@/data/buildings";
import { CAMPUS_STUDENTS } from "@/data/students";
import { SEED_ALERTS, buildSeedAlerts } from "@/data/alerts";
import { SEED_GROUPS, buildSeedGroups, buildSeedNotifications, SEED_NOTIFICATIONS } from "@/data/social";
import { computeRoute } from "@/lib/routing";
import { id } from "@/lib/utils";
import type {
  AlertCategory,
  AppNotification,
  CampusAlert,
  CampusEvent,
  PedestrianRoute,
  PrivacyMode,
  Settings,
  StudyGroup,
  User,
} from "@/types";

export type MapView = "3d" | "2d";
export type MapTime = "day" | "night";

type Toast = {
  id: string;
  title: string;
  description?: string;
  tone: "info" | "success" | "warning" | "danger";
};

type AppState = {
  /* ---------------- auth ---------------- */
  user: User | null;
  onboarded: boolean;
  login: (identifier: string) => void;
  register: (payload: Pick<User, "fullName" | "matricule" | "email" | "faculty" | "department" | "level">) => void;
  completeOnboarding: (payload: { avatarSeed: string; privacy: PrivacyMode; faculty: string; department: string }) => void;
  logout: () => void;

  /* ---------------- map ---------------- */
  mapView: MapView;
  mapTime: MapTime;
  selectedBuildingId: string | null;
  hoveredBuildingId: string | null;
  showLabels: boolean;
  showAvatars: boolean;
  showAlerts: boolean;
  radiusFilterM: number;
  camTargetBuildingId: string | null;
  setMapView: (v: MapView) => void;
  setMapTime: (t: MapTime) => void;
  selectBuilding: (bid: string | null) => void;
  hoverBuilding: (bid: string | null) => void;
  toggleLabels: () => void;
  toggleAvatars: () => void;
  toggleAlerts: () => void;
  setRadiusFilter: (m: number) => void;
  flyToBuilding: (bid: string | null) => void;

  /* ---------------- privacy ---------------- */
  privacy: PrivacyMode;
  setPrivacy: (p: PrivacyMode) => void;

  /* ---------------- navigation ---------------- */
  route: PedestrianRoute | null;
  routeDestinationId: string | null;
  navigating: boolean;
  startNavigation: (toBuildingId: string, fromBuildingId?: string) => void;
  cancelNavigation: () => void;
  setNavigating: (v: boolean) => void;

  /* ---------------- social ---------------- */
  friends: string[];
  friendRequests: { id: string; studentId: string; message: string; createdAt: number }[];
  sentRequests: string[];
  sendFriendRequest: (studentId: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  declineFriendRequest: (requestId: string) => void;
  removeFriend: (studentId: string) => void;

  /* ---------------- alerts ---------------- */
  alerts: CampusAlert[];
  createAlert: (payload: {
    category: AlertCategory;
    title: string;
    description: string;
    buildingId: string;
    severity?: "low" | "medium" | "high";
  }) => void;
  confirmAlert: (alertId: string) => void;
  reportAlert: (alertId: string) => void;
  addAlertComment: (alertId: string, text: string) => void;
  resolveAlert: (alertId: string) => void;
  expireStaleAlerts: () => void;

  /* ---------------- study ---------------- */
  groups: StudyGroup[];
  createGroup: (payload: {
    subject: string;
    topic: string;
    buildingId: string;
    room: string;
    capacity: number;
    durationMin: number;
    department: string;
    tags: string[];
  }) => void;
  joinGroup: (groupId: string) => void;
  leaveGroup: (groupId: string) => void;

  /* ---------------- notifications ---------------- */
  notifications: AppNotification[];
  markNotificationRead: (nid: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;

  /* ---------------- sos ---------------- */
  sosActive: boolean;
  sosActivatedAt: number | null;
  triggerSos: () => void;
  cancelSos: () => void;

  /* ---------------- settings / ui ---------------- */
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  updateNotificationPref: (key: keyof Settings["notifications"], value: boolean) => void;
  resetDemoData: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  recentSearches: string[];
  pushRecentSearch: (q: string) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (tid: string) => void;
  activityEvents: CampusEvent[];
  pushEvent: (e: Omit<CampusEvent, "id" | "at">) => void;
  hydrateSeedData: () => void;
};

const CURRENT_USER_ID = "me";

const DEFAULT_USER: User = {
  id: CURRENT_USER_ID,
  fullName: "Eucher ABATTI",
  matricule: "UAC2024177",
  email: "eucher.abatti@uac.bj",
  faculty: "IFRI — Informatique",
  department: "Génie Logiciel",
  level: "L3",
  bio: "Étudiant en Génie Logiciel à l'IFRI. Je construis des outils numériques pour le campus d'Abomey-Calavi. Fondateur du projet UAC-LIVE 3D.",
  avatarSeed: "eucher",
  privacy: "ghost",
  currentBuildingId: "ifri",
  createdAt: Date.now(),
};

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  reducedMotion: false,
  batterySaver: false,
  auto2DFallback: true,
  mapQuality: "high",
  showAvatars: true,
  showLabels: true,
  alertsRadius: 800,
  notifications: {
    friendRequests: true,
    studyInvites: true,
    campusAlerts: true,
    navigation: true,
  },
  language: "fr",
};

function seedState() {
  return {
    alerts: buildSeedAlerts(),
    groups: buildSeedGroups(),
    notifications: buildSeedNotifications(),
    friends: CAMPUS_STUDENTS.filter((s) => s.isFriend).map((s) => s.id),
    friendRequests: [
      {
        id: "req-001",
        studentId: "stu-006",
        message: "Salut Eucher ! On s'est croisés au hackathon, on se connecte ?",
        createdAt: Date.now() - 4 * 60_000,
      },
      {
        id: "req-002",
        studentId: "stu-011",
        message: "Bonjour, je cherche des ressources partagées pour les partiels.",
        createdAt: Date.now() - 96 * 60_000,
      },
    ],
    sentRequests: [] as string[],
  };
}

const initialSeed = seedState();

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      /* ---------------- auth ---------------- */
      user: null,
      onboarded: false,
      login: (identifier) => {
        const name = identifier.includes("@") ? identifier.split("@")[0]!.replace(/[._]/g, " ") : identifier;
        const pretty = name
          .split(" ")
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        set((s) => ({
          user: {
            ...DEFAULT_USER,
            fullName: pretty.length > 2 ? pretty : DEFAULT_USER.fullName,
            email: identifier.includes("@") ? identifier : `${identifier || "etudiant"}@uac.bj`,
          },
          onboarded: true,
        }));
        get().pushToast({
          title: "Connexion réussie",
          description: "Bienvenue sur UAC-LIVE 3D — session de démonstration.",
          tone: "success",
        });
      },
      register: (payload) => {
        set((s) => ({
          user: { ...DEFAULT_USER, ...payload, id: CURRENT_USER_ID, privacy: "ghost" },
          onboarded: true,
        }));
        get().pushToast({
          title: "Compte simulé créé",
          description: "Aucune donnée réelle n'a été transmise — prototype frontend.",
          tone: "success",
        });
      },
      completeOnboarding: ({ avatarSeed, privacy, faculty, department }) => {
        set((s) => ({
          user: s.user ? { ...s.user, avatarSeed, privacy, faculty, department } : { ...DEFAULT_USER, avatarSeed, privacy, faculty, department },
          privacy,
          onboarded: true,
        }));
      },
      logout: () => {
        set({ user: null, route: null, navigating: false, selectedBuildingId: null, sosActive: false });
      },

      /* ---------------- map ---------------- */
      mapView: "3d",
      mapTime: "day",
      selectedBuildingId: null,
      hoveredBuildingId: null,
      showLabels: true,
      showAvatars: true,
      showAlerts: true,
      radiusFilterM: 800,
      camTargetBuildingId: null,
      setMapView: (v) => set({ mapView: v }),
      setMapTime: (t) => set({ mapTime: t }),
      selectBuilding: (bid) => set({ selectedBuildingId: bid }),
      hoverBuilding: (bid) => set({ hoveredBuildingId: bid }),
      toggleLabels: () => set((s) => ({ showLabels: !s.showLabels, settings: { ...s.settings, showLabels: !s.showLabels } })),
      toggleAvatars: () => set((s) => ({ showAvatars: !s.showAvatars, settings: { ...s.settings, showAvatars: !s.showAvatars } })),
      toggleAlerts: () => set((s) => ({ showAlerts: !s.showAlerts })),
      setRadiusFilter: (m) => set({ radiusFilterM: m }),
      flyToBuilding: (bid) => set({ camTargetBuildingId: bid, selectedBuildingId: bid }),

      /* ---------------- privacy ---------------- */
      privacy: "ghost",
      setPrivacy: (p) => {
        set({ privacy: p, user: get().user ? { ...get().user!, privacy: p } : null });
        const labels: Record<PrivacyMode, string> = {
          open: "Mode Ouvert",
          friends: "Mode Amis",
          zone: "Mode Zone",
          ghost: "Mode Fantôme",
        };
        get().pushToast({
          title: labels[p],
          description:
            p === "ghost"
              ? "Vous êtes invisible sur le radar social du campus."
              : p === "zone"
                ? "Votre position est approximée autour de votre bâtiment."
                : p === "friends"
                  ? "Seuls vos amis voient votre position exacte."
                  : "Votre position exacte est visible par les étudiants vérifiés.",
          tone: p === "ghost" ? "info" : "success",
        });
      },

      /* ---------------- navigation ---------------- */
      route: null,
      routeDestinationId: null,
      navigating: false,
      startNavigation: (toBuildingId, fromBuildingId) => {
        const from = fromBuildingId ?? get().user?.currentBuildingId ?? "ifri";
        const route = computeRoute(from, toBuildingId);
        if (!route) {
          get().pushToast({ title: "Itinéraire indisponible", description: "Choisissez une destination différente de votre position.", tone: "warning" });
          return;
        }
        set({ route, routeDestinationId: toBuildingId, navigating: true, selectedBuildingId: toBuildingId });
        const dest = BUILDING_BY_ID.get(toBuildingId);
        get().pushToast({
          title: `Itinéraire vers ${dest?.shortName ?? "la destination"}`,
          description: `${route.distanceM} m · environ ${route.durationMin} min à pied (simulation).`,
          tone: "info",
        });
        get().pushEvent({ kind: "navigation", buildingId: toBuildingId, message: `Navigation lancée vers ${dest?.shortName ?? toBuildingId}` });
      },
      cancelNavigation: () => set({ route: null, routeDestinationId: null, navigating: false }),
      setNavigating: (v) => set({ navigating: v }),

      /* ---------------- social ---------------- */
      friends: initialSeed.friends,
      friendRequests: initialSeed.friendRequests,
      sentRequests: [],
      sendFriendRequest: (studentId) => {
        set((s) => ({
          sentRequests: s.sentRequests.includes(studentId) ? s.sentRequests : [...s.sentRequests, studentId],
        }));
        const st = CAMPUS_STUDENTS.find((x) => x.id === studentId);
        get().pushToast({ title: "Demande envoyée", description: `Invitation transmise à ${st?.fullName ?? "l'étudiant"} (simulation).`, tone: "success" });
      },
      acceptFriendRequest: (requestId) => {
        const req = get().friendRequests.find((r) => r.id === requestId);
        if (!req) return;
        const st = CAMPUS_STUDENTS.find((s) => s.id === req.studentId);
        set((s) => ({
          friendRequests: s.friendRequests.filter((r) => r.id !== requestId),
          friends: s.friends.includes(req.studentId) ? s.friends : [...s.friends, req.studentId],
        }));
        get().pushToast({ title: "Connexion acceptée", description: `${st?.fullName ?? "Étudiant"} fait partie de vos amis.`, tone: "success" });
        get().pushEvent({ kind: "friend", message: `${st?.fullName ?? "Un étudiant"} a rejoint votre réseau` });
      },
      declineFriendRequest: (requestId) => {
        set((s) => ({ friendRequests: s.friendRequests.filter((r) => r.id !== requestId) }));
        get().pushToast({ title: "Demande ignorée", tone: "info" });
      },
      removeFriend: (studentId) => {
        set((s) => ({ friends: s.friends.filter((f) => f !== studentId) }));
      },

      /* ---------------- alerts ---------------- */
      alerts: initialSeed.alerts,
      createAlert: ({ category, title, description, buildingId, severity = "medium" }) => {
        const author = get().user?.fullName ?? "Vous";
        const alert: CampusAlert = {
          id: id("alert"),
          category,
          title,
          description,
          buildingId,
          author,
          authorId: CURRENT_USER_ID,
          createdAt: Date.now(),
          expiresAt: Date.now() + 3 * 60 * 60_000,
          confirmations: 1,
          reports: 0,
          status: "active",
          severity,
          comments: [],
        };
        set((s) => ({ alerts: [alert, ...s.alerts] }));
        get().pushToast({ title: "Alerte publiée", description: "Visible sur le radar communautaire (simulation).", tone: "success" });
        get().pushEvent({ kind: "alert", buildingId, message: `Nouvelle alerte : ${title}` });
      },
      confirmAlert: (alertId) => {
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, confirmations: a.confirmations + 1 } : a)),
        }));
        get().pushToast({ title: "Alerte confirmée", description: "Merci — votre confirmation renforce la fiabilité.", tone: "success" });
      },
      reportAlert: (alertId) => {
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === alertId
              ? { ...a, reports: a.reports + 1, status: a.reports + 1 >= 3 ? "resolved" : a.status }
              : a,
          ),
        }));
        get().pushToast({ title: "Signalement enregistré", description: "La communauté vérifiera cette alerte.", tone: "warning" });
      },
      addAlertComment: (alertId, text) => {
        const author = get().user?.fullName ?? "Vous";
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === alertId
              ? {
                  ...a,
                  comments: [...a.comments, { id: id("cm"), author, text, createdAt: Date.now() }],
                }
              : a,
          ),
        }));
      },
      resolveAlert: (alertId) => {
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, status: "resolved" } : a)) }));
        get().pushToast({ title: "Alerte résolue", tone: "success" });
      },
      expireStaleAlerts: () => {
        const t = Date.now();
        const stale = get().alerts.filter((a) => a.status === "active" && a.expiresAt < t);
        if (!stale.length) return;
        set((s) => ({
          alerts: s.alerts.map((a) => (a.status === "active" && a.expiresAt < t ? { ...a, status: "expired" } : a)),
        }));
      },

      /* ---------------- study ---------------- */
      groups: initialSeed.groups,
      createGroup: ({ subject, topic, buildingId, room, capacity, durationMin, department, tags }) => {
        const organizer = get().user?.fullName ?? "Vous";
        const group: StudyGroup = {
          id: id("grp"),
          subject,
          topic,
          buildingId,
          room,
          organizer,
          organizerId: CURRENT_USER_ID,
          participants: 1,
          capacity,
          startTime: Date.now() + 30 * 60_000,
          durationMin,
          status: "open",
          tags,
          level: get().user?.level ?? "L3",
          department,
          joined: true,
        };
        set((s) => ({ groups: [group, ...s.groups] }));
        get().pushToast({ title: "Groupe créé", description: `« ${subject} » est visible sur le campus.`, tone: "success" });
        get().pushEvent({ kind: "study", buildingId, message: `Nouveau groupe d'étude : ${subject}` });
      },
      joinGroup: (groupId) => {
        set((s) => ({
          groups: s.groups.map((g) => {
            if (g.id !== groupId) return g;
            const participants = Math.min(g.capacity, g.participants + 1);
            return { ...g, participants, joined: true, status: participants >= g.capacity ? "full" : g.status };
          }),
        }));
        const g = get().groups.find((x) => x.id === groupId);
        get().pushToast({ title: "Groupe rejoint", description: `« ${g?.subject ?? "Groupe"} » — ${g?.room ?? ""}`, tone: "success" });
      },
      leaveGroup: (groupId) => {
        set((s) => ({
          groups: s.groups.map((g) => {
            if (g.id !== groupId) return g;
            const participants = Math.max(1, g.participants - 1);
            return { ...g, participants, joined: false, status: participants < g.capacity && g.status === "full" ? "open" : g.status };
          }),
        }));
        get().pushToast({ title: "Groupe quitté", tone: "info" });
      },

      /* ---------------- notifications ---------------- */
      notifications: initialSeed.notifications,
      markNotificationRead: (nid) =>
        set((s) => ({ notifications: s.notifications.map((n) => (n.id === nid ? { ...n, read: true } : n)) })),
      markAllNotificationsRead: () => {
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
        get().pushToast({ title: "Tout est marqué comme lu", tone: "success" });
      },
      clearNotifications: () => {
        set({ notifications: [] });
        get().pushToast({ title: "Notifications effacées", tone: "info" });
      },

      /* ---------------- sos ---------------- */
      sosActive: false,
      sosActivatedAt: null,
      triggerSos: () => {
        set({ sosActive: true, sosActivatedAt: Date.now() });
        get().pushToast({ title: "SOS simulé activé", description: "Aucune alerte réelle n'a été transmise aux services de sécurité.", tone: "danger" });
        get().pushEvent({ kind: "sos", message: "SOS de démonstration activé" });
      },
      cancelSos: () => {
        set({ sosActive: false, sosActivatedAt: null });
        get().pushToast({ title: "SOS annulé", tone: "info" });
      },

      /* ---------------- settings ---------------- */
      settings: DEFAULT_SETTINGS,
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      updateNotificationPref: (key, value) =>
        set((s) => ({ settings: { ...s.settings, notifications: { ...s.settings.notifications, [key]: value } } })),
      resetDemoData: () => {
        const fresh = seedState();
        set({
          alerts: fresh.alerts,
          groups: fresh.groups,
          notifications: fresh.notifications,
          friends: fresh.friends,
          friendRequests: fresh.friendRequests,
          sentRequests: [],
          route: null,
          navigating: false,
          selectedBuildingId: null,
          sosActive: false,
          sosActivatedAt: null,
          recentSearches: [],
        });
        get().pushToast({ title: "Données de démo réinitialisées", description: "Alertes, groupes et notifications restaurés.", tone: "success" });
      },
      searchQuery: "",
      setSearchQuery: (q) => set({ searchQuery: q }),
      recentSearches: ["IFRI", "Bibliothèque", "Amphi A1", "Restaurant Universitaire"],
      pushRecentSearch: (q) =>
        set((s) => ({ recentSearches: [q, ...s.recentSearches.filter((x) => x !== q)].slice(0, 6) })),
      toasts: [],
      pushToast: (t) => {
        const toast = { ...t, id: id("toast") };
        set((s) => ({ toasts: [...s.toasts, toast].slice(-4) }));
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            useAppStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== toast.id) }));
          }, 4200);
        }
      },
      dismissToast: (tid) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== tid) })),
      activityEvents: [],
      pushEvent: (e) =>
        set((s) => ({
          activityEvents: [{ ...e, id: id("ev"), at: Date.now() }, ...s.activityEvents].slice(0, 30),
        })),
      hydrateSeedData: () => {
        // Rebuild time-relative seed objects so a persisted session never looks stale.
        const fresh = seedState();
        set((s) => ({
          alerts: s.alerts.length ? s.alerts : fresh.alerts,
        }));
      },
    }),
    {
      name: "uac-live-3d:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        user: s.user,
        onboarded: s.onboarded,
        privacy: s.privacy,
        settings: s.settings,
        friends: s.friends,
        friendRequests: s.friendRequests,
        sentRequests: s.sentRequests,
        alerts: s.alerts,
        groups: s.groups,
        notifications: s.notifications,
        recentSearches: s.recentSearches,
        mapView: s.mapView,
        mapTime: s.mapTime,
        showLabels: s.showLabels,
        showAvatars: s.showAvatars,
      }),
    },
  ),
);

/* ------------------------------------------------------------------ */
/* Derived selectors                                                    */
/* ------------------------------------------------------------------ */

export const useUnreadCount = () =>
  useAppStore((s) => s.notifications.filter((n) => !n.read).length);

export const useActiveAlerts = () =>
  useAppStore(useShallow((s) => s.alerts.filter((a) => a.status === "active")));

const NO_ALERTS: CampusAlert[] = [];

export const useBuildingAlerts = (buildingId: string | null) =>
  useAppStore(
    useShallow((s) => (buildingId ? s.alerts.filter((a) => a.buildingId === buildingId && a.status === "active") : NO_ALERTS)),
  );

export const BUILDINGS = CAMPUS_BUILDINGS;
export const DEFAULT_PRIVACY: PrivacyMode = "ghost";
export { DEFAULT_SETTINGS, SEED_ALERTS, SEED_GROUPS, SEED_NOTIFICATIONS };
