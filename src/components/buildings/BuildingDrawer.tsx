"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  DoorOpen,
  Layers,
  Navigation2,
  ShieldAlert,
  Users,
  X,
  Zap,
  CheckCircle2,
  Flag,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { BUILDING_BY_ID, CATEGORY_META } from "@/data/buildings";
import { CAMPUS_STUDENTS, STATUS_META } from "@/data/students";
import { ALERT_META, relativeTime } from "@/data/alerts";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Badge, Button, Meter, Skeleton } from "@/components/ui/primitives";
import { cn, pct } from "@/lib/utils";
import { useState } from "react";

export function BuildingDrawer() {
  const selectedId = useAppStore((s) => s.selectedBuildingId);
  const select = useAppStore((s) => s.selectBuilding);
  const startNav = useAppStore((s) => s.startNavigation);
  const alerts = useAppStore((s) => s.alerts);
  const confirmAlert = useAppStore((s) => s.confirmAlert);
  const reportAlert = useAppStore((s) => s.reportAlert);
  const [tab, setTab] = useState<"overview" | "rooms" | "alerts">("overview");

  const building = selectedId ? BUILDING_BY_ID.get(selectedId) : undefined;
  const meta = building ? CATEGORY_META[building.category] : null;
  const buildingAlerts = building ? alerts.filter((a) => a.buildingId === building.id && a.status === "active") : [];
  const occupants = building
    ? CAMPUS_STUDENTS.filter((s) => s.buildingId === building.id)
    : [];
  const occupancyPct = building ? pct(building.occupants, building.capacity) : 0;

  return (
    <AnimatePresence>
      {building && meta && (
        <motion.aside
          key={building.id}
          initial={{ opacity: 0, x: 36, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 36, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="panel pointer-events-auto absolute right-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[min(370px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl"
        >
          {/* header */}
          <div className="relative overflow-hidden border-b border-white/[0.07] px-4 pb-3.5 pt-4">
            <div
              className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full opacity-25 blur-3xl"
              style={{ background: meta.color }}
            />
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border text-[13px] font-bold"
                  style={{ borderColor: `${meta.color}55`, background: `${meta.color}18`, color: meta.color }}
                >
                  {building.shortName.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-[15px] font-semibold leading-tight text-ink">{building.shortName}</h2>
                  <p className="mt-0.5 text-[11px] text-dim">{meta.label}</p>
                </div>
              </div>
              <button
                onClick={() => select(null)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
                aria-label="Fermer le panneau"
              >
                <X size={15} />
              </button>
            </div>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-dim">{building.description}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="cyan" dot>
                {building.occupants} présents
              </Badge>
              <Badge tone="neutral">
                <Clock size={9} /> {building.openHours}
              </Badge>
              <Badge tone={occupancyPct > 70 ? "warning" : "success"}>
                {occupancyPct > 70 ? "Forte affluence" : occupancyPct > 40 ? "Affluence modérée" : "Calme"}
              </Badge>
            </div>
          </div>

          {/* tabs */}
          <div className="flex gap-1 border-b border-white/[0.07] px-3 pt-1.5">
            {(
              [
                { k: "overview", label: "Aperçu" },
                { k: "rooms", label: `Salles ${building.rooms.length}` },
                { k: "alerts", label: `Alertes ${buildingAlerts.length}` },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={cn(
                  "relative px-2.5 pb-2 pt-1 text-[12px] font-medium transition-colors",
                  tab === t.k ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {t.label}
                {tab === t.k && <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-cyan" />}
              </button>
            ))}
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
            {tab === "overview" && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-dim">Occupation estimée</span>
                    <span className="font-semibold text-ink">
                      {building.occupants} / {building.capacity}
                    </span>
                  </div>
                  <Meter
                    value={building.occupants}
                    max={building.capacity}
                    tone={occupancyPct > 70 ? "warning" : "cyan"}
                    className="mt-1.5"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: Layers, value: building.floors, label: "Niveaux" },
                    { icon: DoorOpen, value: building.rooms.length, label: "Salles" },
                    { icon: Users, value: occupants.length, label: "Amis ici" },
                  ].map((s) => {
                    const Icon = s.icon;
                    return (
                      <div key={s.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-2 py-2 text-center">
                        <Icon size={13} className="mx-auto text-cyan" />
                        <p className="mt-1 text-[15px] font-semibold leading-none text-ink">{s.value}</p>
                        <p className="mt-0.5 text-[10px] text-muted">{s.label}</p>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Équipements</p>
                  <div className="flex flex-wrap gap-1.5">
                    {building.amenities.map((a) => (
                      <span
                        key={a}
                        className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-dim"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>

                {occupants.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Présents sur le radar
                    </p>
                    <div className="flex -space-x-2">
                      {occupants.slice(0, 6).map((s) => (
                        <div key={s.id} className="relative" title={s.fullName}>
                          <Avatar initials={s.initials} seed={s.avatarSeed} size={30} />
                        </div>
                      ))}
                      {occupants.length > 6 && (
                        <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-white/10 bg-[#16243a] text-[10px] font-semibold text-dim">
                          +{occupants.length - 6}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[10.5px] leading-relaxed text-muted">
                  Géométrie et coordonnées de démonstration. Aucune borne GPS réelle n&apos;est utilisée dans ce prototype.
                </p>
              </div>
            )}

            {tab === "rooms" && (
              <div className="space-y-1.5">
                {building.rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink">{room.name}</p>
                      <p className="text-[10.5px] text-muted">{room.capacity} places</p>
                    </div>
                    <Badge tone={room.occupied ? "warning" : "success"} dot>
                      {room.occupied ? "Occupée" : "Libre"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {tab === "alerts" && (
              <div className="space-y-2">
                {buildingAlerts.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
                    <CheckCircle2 size={22} className="mx-auto text-success/70" />
                    <p className="mt-1.5 text-[12.5px] font-medium text-ink">Aucune alerte active</p>
                    <p className="mt-0.5 text-[11px] text-dim">Ce bâtiment ne présente aucun signalement en cours.</p>
                  </div>
                )}
                {buildingAlerts.map((a) => {
                  const am = ALERT_META[a.category];
                  return (
                    <div key={a.id} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                          style={{ background: `${am.color}1f`, color: am.color }}
                        >
                          <ShieldAlert size={12} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium leading-snug text-ink">{a.title}</p>
                          <p className="mt-0.5 text-[10.5px] text-muted">
                            {a.author} · {relativeTime(a.createdAt)}
                          </p>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <button
                              onClick={() => confirmAlert(a.id)}
                              className="flex items-center gap-1 rounded-md border border-white/[0.09] px-1.5 py-0.5 text-[10px] text-dim transition-colors hover:border-success/40 hover:text-success"
                            >
                              <CheckCircle2 size={10} /> {a.confirmations}
                            </button>
                            <button
                              onClick={() => reportAlert(a.id)}
                              className="flex items-center gap-1 rounded-md border border-white/[0.09] px-1.5 py-0.5 text-[10px] text-dim transition-colors hover:border-danger/40 hover:text-danger"
                            >
                              <Flag size={10} /> {a.reports}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* footer CTA */}
          <div className="flex gap-2 border-t border-white/[0.07] p-3">
            <Button variant="primary" full onClick={() => startNav(building.id)}>
              <Navigation2 size={14} /> Itinéraire
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const ev = new CustomEvent("uac:focus-alert-form", { detail: { buildingId: building.id } });
                document.dispatchEvent(ev);
                select(null);
                window.location.href = "/alerts";
              }}
              aria-label="Signaler"
            >
              <Zap size={14} />
            </Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Student profile modal                                               */
/* ------------------------------------------------------------------ */

export function StudentProfileModal({
  studentId,
  onClose,
}: {
  studentId: string | null;
  onClose: () => void;
}) {
  const student = studentId ? CAMPUS_STUDENTS.find((s) => s.id === studentId) : undefined;
  const privacy = useAppStore((s) => s.privacy);
  const friends = useAppStore((s) => s.friends);
  const sent = useAppStore((s) => s.sentRequests);
  const sendFriendRequest = useAppStore((s) => s.sendFriendRequest);
  const pushToast = useAppStore((s) => s.pushToast);
  const building = student ? BUILDING_BY_ID.get(student.buildingId) : undefined;

  if (!student) return null;
  const isFriend = friends.includes(student.id);
  const isSent = sent.includes(student.id);
  const points = Math.max(0, Math.min(6, Math.round(student.reputation / 16)));

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center sm:p-6">
      <button className="absolute inset-0 bg-[#04070d]/80 backdrop-blur-sm" onClick={onClose} aria-label="Fermer" />
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="panel relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl sm:rounded-3xl"
      >
        <div className="relative h-24 overflow-hidden bg-gradient-to-br from-cyan/25 via-[#0d2233] to-violet/25">
          <div className="absolute inset-0 map-grid-lines opacity-40" />
          <button
            onClick={onClose}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-black/30 text-white/80 backdrop-blur hover:bg-black/50"
            aria-label="Fermer"
          >
            <X size={15} />
          </button>
        </div>
        <div className="-mt-9 px-5 pb-5">
          <div className="flex items-end justify-between">
            <Avatar
              initials={student.initials}
              seed={student.avatarSeed}
              size={72}
              ring
              status={student.online ? "online" : "offline"}
            />
            <div className="mb-1 flex items-center gap-1.5">
              {student.privacy !== "ghost" && (
                <Badge tone="cyan" dot>
                  Visible
                </Badge>
              )}
              {isFriend && <Badge tone="success">Ami</Badge>}
            </div>
          </div>

          <h3 className="mt-3 font-display text-[17px] font-semibold text-ink">{student.fullName}</h3>
          <p className="mt-0.5 text-[12.5px] text-dim">
            {student.department} · {student.level}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">{student.faculty}</p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderColor: `${STATUS_META[student.status].color}44`,
                background: `${STATUS_META[student.status].color}14`,
                color: STATUS_META[student.status].color,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {STATUS_META[student.status].label}
            </span>
            {building && (
              <Badge tone="neutral">
                <Navigation2 size={9} /> {building.shortName}
              </Badge>
            )}
            <Badge tone="violet">
              <Sparkles size={9} /> {student.reputation} pts
            </Badge>
          </div>

          <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[12.5px] leading-relaxed text-dim">
            {student.bio}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { v: student.mutualFriends ?? 0, l: "Amis communs" },
              { v: student.contributions, l: "Contributions" },
              { v: `${points}/6`, l: "Fiabilité" },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-white/[0.07] bg-white/[0.03] py-2">
                <p className="text-[15px] font-semibold leading-none text-ink">{s.v}</p>
                <p className="mt-1 text-[10px] text-muted">{s.l}</p>
              </div>
            ))}
          </div>

          <p className="mt-2.5 text-[10.5px] text-muted">
            Activité actuelle : <span className="text-dim">{student.activity}</span>
          </p>

          {privacy === "ghost" && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-warning/20 bg-warning/[0.07] px-2.5 py-2 text-[10.5px] leading-relaxed text-warning">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              Vous êtes en mode Fantôme : votre profil est visible, mais votre position reste masquée.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant={isFriend ? "secondary" : "primary"}
              full
              disabled={isFriend || isSent}
              onClick={() => sendFriendRequest(student.id)}
            >
              {isFriend ? (
                <>Déjà ami</>
              ) : isSent ? (
                <>Demande envoyée</>
              ) : (
                <>
                  <Users size={14} /> Se connecter
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                pushToast({
                  title: "Messagerie (simulation)",
                  description: `Aucun message réel n'est envoyé à ${student.fullName} dans ce prototype.`,
                  tone: "info",
                })
              }
            >
              <MessageSquare size={14} />
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted">
            Profil et présence simulés — données de démonstration
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export function BuildingListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function DrawerCTA({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-cyan/25 bg-cyan/[0.08] px-3 py-2.5 text-[12.5px] font-medium text-cyan transition-colors hover:bg-cyan/[0.14]"
    >
      {label}
      <ArrowRight size={14} />
    </button>
  );
}
