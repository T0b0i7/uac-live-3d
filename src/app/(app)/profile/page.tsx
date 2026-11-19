"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Check,
  Eye,
  Ghost,
  CircleDashed,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  MapPin,
  Award,
  Activity,
  X,
  Lock,
  ShieldAlert,
  Bell,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Badge, Button, Field, inputClass, Meter } from "@/components/ui/primitives";
import { PRIVACY_META, CAMPUS_STUDENTS } from "@/data/students";
import { BUILDING_BY_ID } from "@/data/buildings";
import type { PrivacyMode } from "@/types";
import { cn } from "@/lib/utils";

const PRIVACY_ICONS = { open: Eye, friends: Users, zone: CircleDashed, ghost: Ghost };
const ORDER: PrivacyMode[] = ["ghost", "zone", "friends", "open"];

export default function ProfilePage() {
  const user = useAppStore((s) => s.user);
  const privacy = useAppStore((s) => s.privacy);
  const setPrivacy = useAppStore((s) => s.setPrivacy);
  const friends = useAppStore((s) => s.friends);
  const groups = useAppStore((s) => s.groups);
  const alerts = useAppStore((s) => s.alerts);
  const notifications = useAppStore((s) => s.notifications);
  const [editing, setEditing] = useState(false);

  const [draft, setDraft] = useState({
    fullName: user?.fullName ?? "",
    matricule: user?.matricule ?? "",
    email: user?.email ?? "",
    faculty: user?.faculty ?? "",
    department: user?.department ?? "",
    level: user?.level ?? "",
    bio: user?.bio ?? "",
  });

  const myGroups = groups.filter((g) => g.joined);
  const myAlerts = alerts.filter((a) => a.authorId === "me");
  const friendStudents = CAMPUS_STUDENTS.filter((s) => friends.includes(s.id));
  const building = BUILDING_BY_ID.get(user?.currentBuildingId ?? "ifri");
  const reputation = 128 + myAlerts.length * 12 + myGroups.length * 8;
  const maskedMatricule = user?.matricule ? `${user.matricule.slice(0, 4)}••••${user.matricule.slice(-2)}` : "—";

  const save = () => {
    // Persisted through the store's user object.
    useAppStore.setState((s) => ({ user: s.user ? { ...s.user, ...draft } : s.user }));
    setEditing(false);
    useAppStore.getState().pushToast({
      title: "Profil mis à jour",
      description: "Modifications enregistrées localement sur cet appareil.",
      tone: "success",
    });
  };

  const contributions = useMemo(
    () => [
      { icon: ShieldAlert, label: "Alertes créées", value: myAlerts.length, tone: "warning" },
      { icon: Users, label: "Groupes rejoints", value: myGroups.length, tone: "violet" },
      { icon: Activity, label: "Confirmations", value: myAlerts.reduce((a, b) => a + b.confirmations, 0) + 34, tone: "cyan" },
      { icon: Award, label: "Badges", value: 5, tone: "success" },
    ],
    [myAlerts, myGroups],
  );

  return (
    <div className="min-h-screen">
      {/* hero */}
      <div className="relative overflow-hidden border-b border-white/[0.07]">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan/18 via-[#0a1a26] to-violet/18" />
        <div className="absolute inset-0 map-grid-lines opacity-30" />
        <div className="relative mx-auto max-w-5xl px-4 pb-5 pt-7 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="relative">
              <span className="absolute inset-0 animate-pulse-ring rounded-full border border-cyan/25" />
              <Avatar
                initials={(user?.fullName ?? "EA").split(" ").map((w) => w[0]).slice(0, 2).join("")}
                seed={user?.avatarSeed ?? "eucher"}
                size={92}
                ring
                status="online"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[23px] font-bold tracking-tight text-ink">{user?.fullName}</h1>
                <BadgeCheck size={17} className="text-cyan" />
                <Badge tone="cyan">Étudiant vérifié (démo)</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-dim">
                {user?.department} · {user?.level} · {user?.faculty}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">
                  <Lock size={9} /> {maskedMatricule}
                </Badge>
                <Badge tone="neutral">
                  <MapPin size={9} /> {building?.shortName}
                </Badge>
                <Badge tone="violet">
                  <Sparkles size={9} /> {reputation} pts de réputation
                </Badge>
              </div>
            </div>
            <div className="flex gap-1.5">
              {editing ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                    <X size={13} /> Annuler
                  </Button>
                  <Button size="sm" variant="primary" onClick={save}>
                    <Save size={13} /> Enregistrer
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil size={13} /> Modifier
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          {/* left column */}
          <div className="space-y-3">
            {/* info card */}
            <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                <ShieldCheck size={13} className="text-cyan" /> Informations
              </h2>
              {editing ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="Nom complet">
                    <input value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Matricule">
                    <input value={draft.matricule} onChange={(e) => setDraft({ ...draft, matricule: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Email">
                    <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Niveau">
                    <select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} className={inputClass}>
                      {["L1", "L2", "L3", "L4", "M1", "M2", "Doctorat"].map((l) => (
                        <option key={l} value={l} className="bg-[#0d1422]">
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Faculté">
                    <input value={draft.faculty} onChange={(e) => setDraft({ ...draft, faculty: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Département">
                    <input value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} className={inputClass} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Biographie">
                      <textarea value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} className={cn(inputClass, "min-h-[80px] resize-none")} />
                    </Field>
                  </div>
                </div>
              ) : (
                <dl className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    { k: "Nom complet", v: user?.fullName },
                    { k: "Matricule", v: maskedMatricule },
                    { k: "Email universitaire", v: user?.email },
                    { k: "Niveau", v: user?.level },
                    { k: "Faculté", v: user?.faculty },
                    { k: "Département", v: user?.department },
                  ].map((row) => (
                    <div key={row.k} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-muted">{row.k}</dt>
                      <dd className="mt-0.5 truncate text-[12.5px] font-medium text-ink">{row.v}</dd>
                    </div>
                  ))}
                  <div className="sm:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <dt className="text-[10px] uppercase tracking-wider text-muted">Biographie</dt>
                    <dd className="mt-0.5 text-[12.5px] leading-relaxed text-dim">{user?.bio}</dd>
                  </div>
                </dl>
              )}
            </section>

            {/* contributions */}
            <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                <TrendingUp size={13} className="text-cyan" /> Contributions au campus
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {contributions.map((c) => {
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.label}
                      className={cn(
                        "rounded-xl border px-2.5 py-2.5",
                        c.tone === "warning" && "border-warning/20 bg-warning/[0.06]",
                        c.tone === "violet" && "border-violet/20 bg-violet/[0.06]",
                        c.tone === "cyan" && "border-cyan/20 bg-cyan/[0.06]",
                        c.tone === "success" && "border-success/20 bg-success/[0.06]",
                      )}
                    >
                      <Icon
                        size={13}
                        className={cn(
                          c.tone === "warning" && "text-warning",
                          c.tone === "violet" && "text-[#b79cff]",
                          c.tone === "cyan" && "text-cyan",
                          c.tone === "success" && "text-success",
                        )}
                      />
                      <p className="mt-1.5 font-display text-[18px] font-bold leading-none text-ink">{c.value}</p>
                      <p className="mt-1 text-[9.5px] leading-tight text-muted">{c.label}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-dim">Progression réputation</span>
                  <span className="font-semibold text-ink">{reputation} / 200</span>
                </div>
                <Meter value={reputation} max={200} tone="violet" className="mt-1" />
              </div>
            </section>

            {/* friends preview */}
            <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Users size={13} className="text-cyan" /> Mes amis
                </h2>
                <Link href="/friends" className="text-[11px] font-medium text-cyan hover:underline">
                  Voir tout
                </Link>
              </div>
              {friendStudents.length === 0 ? (
                <p className="text-[12px] text-dim">Aucun ami pour l&apos;instant.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {friendStudents.slice(0, 6).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                      <Avatar initials={s.initials} seed={s.avatarSeed} size={26} status={s.online ? "online" : "offline"} />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-ink">{s.fullName}</p>
                        <p className="truncate text-[9px] text-muted">{s.level}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* right column */}
          <div className="space-y-3">
            {/* privacy */}
            <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                <ShieldCheck size={13} className="text-cyan" /> Confidentialité
              </h2>
              <p className="mb-2.5 text-[11.5px] leading-relaxed text-dim">
                Contrôlez qui peut voir votre position sur le radar social.
              </p>
              <div className="space-y-1.5">
                {ORDER.map((p) => {
                  const m = PRIVACY_META[p];
                  const Icon = PRIVACY_ICONS[p];
                  const active = privacy === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setPrivacy(p)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
                        active ? "border-cyan/40 bg-cyan/[0.08]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]",
                      )}
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                        style={{ background: `${m.color}18`, color: active ? m.color : "#94a3b8" }}
                      >
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-semibold text-ink">{m.label}</span>
                        <span className="block truncate text-[10px] text-muted">{m.detail}</span>
                      </span>
                      {active && <Check size={13} className="shrink-0 text-cyan" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10px] leading-relaxed text-muted">
                Aucune position réelle n&apos;est collectée. Le prototype n&apos;accède jamais au GPS.
              </p>
            </section>

            {/* activity summary */}
            <section className="rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
              <h2 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                <Activity size={13} className="text-cyan" /> Activité
              </h2>
              <div className="space-y-1.5">
                {myGroups.length === 0 && myAlerts.length === 0 && (
                  <p className="text-[11.5px] leading-relaxed text-dim">
                    Aucune activité récente. Rejoignez un groupe d&apos;étude ou signalez une alerte.
                  </p>
                )}
                {myGroups.map((g) => (
                  <Link
                    key={g.id}
                    href="/study"
                    className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] text-dim transition-colors hover:text-ink"
                  >
                    <Check size={11} className="shrink-0 text-success" />
                    <span className="truncate">Groupe : {g.subject}</span>
                  </Link>
                ))}
                {myAlerts.slice(0, 3).map((a) => (
                  <Link
                    key={a.id}
                    href="/alerts"
                    className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] text-dim transition-colors hover:text-ink"
                  >
                    <ShieldAlert size={11} className="shrink-0 text-warning" />
                    <span className="truncate">{a.title}</span>
                  </Link>
                ))}
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] text-dim">
                  <Bell size={11} className="shrink-0 text-cyan" />
                  {notifications.length} notifications reçues
                </div>
              </div>
            </section>

            <Link href="/settings" className="block">
              <Button variant="secondary" full>
                Paramètres du compte
              </Button>
            </Link>
          </div>
        </div>

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-muted">
          Profil de démonstration · les modifications sont enregistrées uniquement dans le stockage local du navigateur.
        </p>
      </div>
    </div>
  );
}

