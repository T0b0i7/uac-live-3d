"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, BellRing, GraduationCap, ShieldAlert, TrendingUp, Users, Zap } from "lucide-react";
import { BUILDING_BY_ID } from "@/data/buildings";
import { CAMPUS_STUDENTS, STATUS_META } from "@/data/students";
import { ALERT_META, relativeTime } from "@/data/alerts";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Badge, Meter } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function ActivityPanel({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const alerts = useAppStore((s) => s.alerts);
  const groups = useAppStore((s) => s.groups);
  const flyTo = useAppStore((s) => s.flyToBuilding);
  const friends = useAppStore((s) => s.friends);

  const activeAlerts = alerts.filter((a) => a.status === "active");
  const urgent = activeAlerts.filter((a) => a.severity === "high").slice(0, 2);
  const activeStudents = CAMPUS_STUDENTS.filter((s) => s.privacy !== "ghost");
  const onlineCount = CAMPUS_STUDENTS.filter((s) => s.online).length;
  const openGroups = groups.filter((g) => g.status !== "full");
  const friendStudents = CAMPUS_STUDENTS.filter((s) => friends.includes(s.id));

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* live header */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-[13.5px] font-semibold tracking-tight text-ink">Activité du campus</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> En direct
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Users, value: activeStudents.length, label: "Actifs", tone: "cyan" },
          { icon: ShieldAlert, value: activeAlerts.length, label: "Alertes", tone: "warning" },
          { icon: GraduationCap, value: openGroups.length, label: "Groupes", tone: "violet" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className={cn(
                "rounded-xl border px-2 py-2 text-center transition-colors",
                k.tone === "cyan" && "border-cyan/20 bg-cyan/[0.07]",
                k.tone === "warning" && "border-warning/20 bg-warning/[0.07]",
                k.tone === "violet" && "border-violet/20 bg-violet/[0.07]",
              )}
            >
              <Icon
                size={14}
                className={cn(
                  "mx-auto",
                  k.tone === "cyan" && "text-cyan",
                  k.tone === "warning" && "text-warning",
                  k.tone === "violet" && "text-[#b79cff]",
                )}
              />
              <p className="mt-1 font-display text-[17px] font-bold leading-none text-ink">
                {String(k.value).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9.5px] font-medium uppercase tracking-wider text-muted">{k.label}</p>
            </div>
          );
        })}
      </div>

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {/* urgent alerts */}
        {urgent.length > 0 && (
          <div className="space-y-1.5">
            {urgent.map((a) => {
              const am = ALERT_META[a.category];
              const b = BUILDING_BY_ID.get(a.buildingId);
              return (
                <Link
                  key={a.id}
                  href="/alerts"
                  className="group relative block overflow-hidden rounded-xl border border-danger/25 bg-gradient-to-r from-danger/[0.12] to-transparent px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-danger/20 text-danger">
                      <Zap size={12} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-danger">Alerte urgente</p>
                      <p className="mt-0.5 truncate text-[12px] font-medium text-ink">{a.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {b?.shortName} · signalé {relativeTime(a.createdAt)}
                      </p>
                    </div>
                    <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-danger/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* friends nearby */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Amis à proximité</p>
            <Badge tone="cyan">{friendStudents.length}</Badge>
          </div>
          <div className="space-y-1">
            {friendStudents.slice(0, 4).map((s) => {
              const b = BUILDING_BY_ID.get(s.buildingId);
              return (
                <button
                  key={s.id}
                  onClick={() => onOpenStudent(s.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <Avatar initials={s.initials} seed={s.avatarSeed} size={26} status={s.online ? "online" : "offline"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">{s.fullName}</span>
                    <span className="block truncate text-[9.5px] text-muted">{b?.shortName}</span>
                  </span>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: STATUS_META[s.status].color }}
                    title={STATUS_META[s.status].label}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* study groups */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Groupes d&apos;étude</p>
            <Link href="/study" className="text-[10px] font-medium text-cyan hover:underline">
              Tout voir
            </Link>
          </div>
          <div className="space-y-1.5">
            {openGroups.slice(0, 3).map((g) => {
              const b = BUILDING_BY_ID.get(g.buildingId);
              return (
                <button
                  key={g.id}
                  onClick={() => flyTo(g.buildingId)}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-left transition-colors hover:border-cyan/30"
                >
                  <p className="truncate text-[11.5px] font-medium text-ink">{g.subject}</p>
                  <p className="mt-0.5 truncate text-[9.5px] text-muted">
                    {b?.shortName} · {g.room}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Meter value={g.participants} max={g.capacity} height={3} className="flex-1" />
                    <span className="text-[9px] tabular-nums text-muted">
                      {g.participants}/{g.capacity}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* privacy insight */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
            <TrendingUp size={11} /> Fréquentation
          </p>
          <div className="space-y-1.5">
            {["ifri", "bibliotheque", "espace-etudiant"].map((id) => {
              const b = BUILDING_BY_ID.get(id);
              if (!b) return null;
              const p = Math.round((b.occupants / b.capacity) * 100);
              return (
                <div key={id}>
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span className="text-dim">{b.shortName}</span>
                    <span className="tabular-nums text-muted">{p}%</span>
                  </div>
                  <Meter value={b.occupants} max={b.capacity} height={3} tone={p > 70 ? "warning" : "cyan"} className="mt-0.5" />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
          <Activity size={13} className="shrink-0 text-cyan" />
          <p className="text-[10.5px] leading-relaxed text-muted">
            <span className="font-semibold text-ink">{onlineCount}</span> étudiants connectés · données simulées
          </p>
        </div>

        <Link
          href="/notifications"
          className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-[11px] text-dim transition-colors hover:border-cyan/30 hover:text-ink"
        >
          <BellRing size={12} className="text-cyan" />
          Voir toutes les notifications
        </Link>
      </div>
    </div>
  );
}
