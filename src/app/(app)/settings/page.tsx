"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Accessibility,
  Bell,
  Database,
  Gauge,
  Lock,
  LogOut,
  Map as MapIcon,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Badge, Button, Field, inputClass, Modal, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { CAMPUS_STUDENTS } from "@/data/students";
import { Avatar } from "@/components/ui/primitives";
import type { PrivacyMode } from "@/types";

const SECTIONS = [
  { id: "account", label: "Compte", icon: User },
  { id: "privacy", label: "Confidentialité", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "map", label: "Carte", icon: MapIcon },
  { id: "data", label: "Données & hors-ligne", icon: Database },
  { id: "accessibility", label: "Accessibilité", icon: Accessibility },
] as const;

const PRIVACY_LABELS: Record<PrivacyMode, string> = {
  open: "Ouvert — position exacte visible",
  friends: "Amis — cercle restreint",
  zone: "Zone — position approximative",
  ghost: "Fantôme — invisible",
};

export default function SettingsPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const updateNotif = useAppStore((s) => s.updateNotificationPref);
  const privacy = useAppStore((s) => s.privacy);
  const setPrivacy = useAppStore((s) => s.setPrivacy);
  const resetDemo = useAppStore((s) => s.resetDemoData);
  const logout = useAppStore((s) => s.logout);
  const pushToast = useAppStore((s) => s.pushToast);
  const [active, setActive] = useState<(typeof SECTIONS)[number]["id"]>("account");
  const [resetOpen, setResetOpen] = useState(false);

  const clearCache = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("uac-live-3d"))
        .forEach((k) => localStorage.removeItem(k));
      pushToast({ title: "Cache local effacé", description: "Les données de démonstration seront régénérées.", tone: "success" });
    } catch {
      pushToast({ title: "Impossible de vider le cache", tone: "danger" });
    }
  };

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/[0.07] bg-gradient-to-b from-[#0b1320] to-transparent px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/[0.06] text-cyan">
              <SlidersHorizontal size={17} />
            </span>
            <div>
              <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Paramètres</h1>
              <p className="text-[11.5px] text-dim">Personnalisez votre expérience campus</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[210px_1fr]">
          {/* section nav */}
          <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const on = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] font-medium transition-colors lg:w-full",
                    on ? "bg-cyan/12 text-cyan" : "text-muted hover:bg-white/[0.05] hover:text-ink",
                  )}
                >
                  <Icon size={14} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* panels */}
          <div className="space-y-3">
            {active === "account" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Compte</h2>
                <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <Avatar
                    initials={(user?.fullName ?? "EA").split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    seed={user?.avatarSeed ?? "eucher"}
                    size={48}
                    status="online"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{user?.fullName}</p>
                    <p className="truncate text-[11px] text-muted">{user?.email}</p>
                  </div>
                  <Badge tone="cyan">Démo</Badge>
                </div>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <Field label="Matricule">
                    <input value={user?.matricule ?? ""} readOnly className={cn(inputClass, "opacity-70")} />
                  </Field>
                  <Field label="Niveau">
                    <input value={user?.level ?? ""} readOnly className={cn(inputClass, "opacity-70")} />
                  </Field>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => router.push("/profile")}>
                    Modifier le profil
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      logout();
                      router.push("/login");
                    }}
                  >
                    <LogOut size={13} /> Se déconnecter
                  </Button>
                </div>
              </section>
            )}

            {active === "privacy" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <ShieldCheck size={13} className="text-cyan" /> Confidentialité
                </h2>
                <Field label="Mode de visibilité actuel">
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value as PrivacyMode)}
                    className={inputClass}
                  >
                    {(Object.keys(PRIVACY_LABELS) as PrivacyMode[]).map((p) => (
                      <option key={p} value={p} className="bg-[#0d1422]">
                        {PRIVACY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="mt-3 space-y-1 border-t border-white/[0.07] pt-2">
                  <Switch
                    checked={settings.showAvatars}
                    onChange={(v) => update({ showAvatars: v })}
                    label="Afficher le radar étudiant"
                    description="Masquez tous les avatars du campus si vous préférez la discrétion."
                  />
                  <Switch
                    checked={settings.auto2DFallback}
                    onChange={(v) => update({ auto2DFallback: v })}
                    label="Repli 2D automatique"
                    description="Bascule en carte vectorielle si le rendu 3D n'est pas disponible."
                  />
                </div>
                <p className="mt-2 rounded-lg border border-cyan/15 bg-cyan/[0.05] px-2.5 py-2 text-[10.5px] leading-relaxed text-dim">
                  Ce prototype ne lit jamais votre GPS. Aucune position réelle n&apos;est stockée ni transmise.
                </p>
              </section>
            )}

            {active === "notifications" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Notifications</h2>
                <div className="divide-y divide-white/[0.06]">
                  <Switch
                    checked={settings.notifications.friendRequests}
                    onChange={(v) => updateNotif("friendRequests", v)}
                    label="Demandes d'amis"
                    description="Nouvelles connexions et acceptations."
                  />
                  <Switch
                    checked={settings.notifications.studyInvites}
                    onChange={(v) => updateNotif("studyInvites", v)}
                    label="Invitations aux groupes d'étude"
                    description="Sessions créées près de vous."
                  />
                  <Switch
                    checked={settings.notifications.campusAlerts}
                    onChange={(v) => updateNotif("campusAlerts", v)}
                    label="Alertes du campus"
                    description="Coupures, files d'attente, sécurité."
                  />
                  <Switch
                    checked={settings.notifications.navigation}
                    onChange={(v) => updateNotif("navigation", v)}
                    label="Mises à jour de navigation"
                    description="Itinéraires prêts et changements de trajet."
                  />
                </div>
                <p className="mt-2 text-[10.5px] text-muted">
                  Les notifications sont générées localement — aucun service push n&apos;est connecté.
                </p>
              </section>
            )}

            {active === "appearance" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Apparence</h2>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { k: "dark", label: "Sombre", icon: Moon, desc: "Interface spatiale premium" },
                      { k: "light", label: "Clair", icon: Sun, desc: "Mode jour opérationnel" },
                    ] as const
                  ).map((t) => {
                    const Icon = t.icon;
                    const on = settings.theme === t.k;
                    return (
                      <button
                        key={t.k}
                        onClick={() => update({ theme: t.k })}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          on ? "border-cyan/45 bg-cyan/[0.08]" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]",
                        )}
                      >
                        <Icon size={16} className={on ? "text-cyan" : "text-muted"} />
                        <p className="mt-2 text-[12.5px] font-semibold text-ink">{t.label}</p>
                        <p className="mt-0.5 text-[10.5px] text-muted">{t.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 border-t border-white/[0.07] pt-2">
                  <Switch
                    checked={settings.reducedMotion}
                    onChange={(v) => update({ reducedMotion: v })}
                    label="Réduire les animations"
                    description="Désactive les transitions et animations non essentielles."
                  />
                </div>
              </section>
            )}

            {active === "map" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Gauge size={13} className="text-cyan" /> Préférences de carte
                </h2>
                <Field label="Qualité de rendu" hint="Une qualité basse améliore les performances sur mobile d'entrée de gamme.">
                  <div className="flex gap-1.5">
                    {(["low", "medium", "high"] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => update({ mapQuality: q })}
                        className={cn(
                          "flex-1 rounded-lg border py-2 text-[11.5px] font-medium capitalize transition-colors",
                          settings.mapQuality === q
                            ? "border-cyan/45 bg-cyan/12 text-cyan"
                            : "border-white/[0.08] bg-white/[0.02] text-muted hover:text-ink",
                        )}
                      >
                        {q === "low" ? "Basse" : q === "medium" ? "Moyenne" : "Haute"}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="mt-2 border-t border-white/[0.07] pt-2">
                  <Switch
                    checked={settings.batterySaver}
                    onChange={(v) => update({ batterySaver: v })}
                    label="Mode économie de batterie"
                    description="Réduit la résolution, les ombres et le nombre d'arbres."
                  />
                  <Switch
                    checked={settings.showLabels}
                    onChange={(v) => update({ showLabels: v })}
                    label="Étiquettes des bâtiments"
                    description="Affiche les noms sur la carte et la scène 3D."
                  />
                </div>
                <Field label={`Rayon des alertes — ${settings.alertsRadius} m`}>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={100}
                    value={settings.alertsRadius}
                    onChange={(e) => update({ alertsRadius: Number(e.target.value) })}
                    className="mt-2 w-full"
                  />
                </Field>
              </section>
            )}

            {active === "data" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Database size={13} className="text-cyan" /> Données & hors-ligne
                </h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                    <div>
                      <p className="text-[12.5px] font-medium text-ink">Stockage local</p>
                      <p className="text-[10.5px] text-muted">Profil, préférences, alertes, groupes</p>
                    </div>
                    <Badge tone="success">localStorage</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                    <div>
                      <p className="text-[12.5px] font-medium text-ink">PWA</p>
                      <p className="text-[10.5px] text-muted">Manifeste installé · cache statique</p>
                    </div>
                    <Badge tone="cyan">Actif</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                    <div>
                      <p className="text-[12.5px] font-medium text-ink">Modèle étudiants</p>
                      <p className="text-[10.5px] text-muted">{CAMPUS_STUDENTS.length} profils simulés</p>
                    </div>
                    <Badge tone="neutral">Mock</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)}>
                    <RotateCcw size={13} /> Réinitialiser la démo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearCache}>
                    <Trash2 size={13} /> Vider le cache local
                  </Button>
                </div>
                <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/20 bg-warning/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed text-warning">
                  <Zap size={11} className="mt-0.5 shrink-0" />
                  Couche réseau non implémentée : toutes les données sont locales. Une API réelle pourra être branchée
                  via les interfaces de service documentées dans le README.
                </p>
              </section>
            )}

            {active === "accessibility" && (
              <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
                <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Accessibility size={13} className="text-cyan" /> Accessibilité
                </h2>
                <div className="divide-y divide-white/[0.06]">
                  <Switch
                    checked={settings.reducedMotion}
                    onChange={(v) => update({ reducedMotion: v })}
                    label="Mouvement réduit"
                    description="Respecte aussi la préférence système si activée."
                  />
                  <Switch
                    checked={settings.language === "fr"}
                    onChange={(v) => update({ language: v ? "fr" : "en" })}
                    label="Interface en français"
                    description="La traduction anglaise complète reste à venir."
                  />
                </div>
                <ul className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-dim">
                  <li>• Contrastes vérifiés sur les panneaux flottants.</li>
                  <li>• Navigation clavier sur la barre latérale et les modales (Échap pour fermer).</li>
                  <li>• Cibles tactiles de 44 px minimum sur mobile.</li>
                  <li>• Alternatives textuelles pour les contrôles de carte.</li>
                </ul>
              </section>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-muted">
          UAC-LIVE 3D · prototype frontend · Eucher ABATTI · les paramètres sont enregistrés dans votre navigateur.
        </p>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Réinitialiser les données de démonstration"
        description="Alertes, groupes et notifications seront restaurés à leur état initial."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setResetOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              full
              onClick={() => {
                resetDemo();
                setResetOpen(false);
              }}
            >
              <RotateCcw size={14} /> Réinitialiser
            </Button>
          </div>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-dim">
          Vos modifications locales (alertes créées, groupes rejoints, demandes d&apos;amis) seront perdues. Votre profil
          et vos préférences seront conservés.
        </p>
      </Modal>
    </div>
  );
}
