"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Flag,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Zap,
  ZapOff,
  Users,
  DoorOpen,
  UserCheck,
  CalendarDays,
  Wrench,
  Send,
  Navigation2,
} from "lucide-react";
import { ALERT_META, relativeTime, remainingTime } from "@/data/alerts";
import { BUILDING_BY_ID, CAMPUS_BUILDINGS } from "@/data/buildings";
import { useAppStore } from "@/store/useAppStore";
import { Badge, Button, EmptyState, Field, inputClass, Modal } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { AlertCategory, CampusAlert } from "@/types";

const ICONS: Record<AlertCategory, typeof Zap> = {
  "power-outage": ZapOff,
  "power-restored": Zap,
  queue: Users,
  "room-change": DoorOpen,
  professor: UserCheck,
  event: CalendarDays,
  security: ShieldAlert,
  infrastructure: Wrench,
};

const CATEGORIES = Object.keys(ALERT_META) as AlertCategory[];

export default function AlertsPage() {
  const alerts = useAppStore((s) => s.alerts);
  const confirmAlert = useAppStore((s) => s.confirmAlert);
  const reportAlert = useAppStore((s) => s.reportAlert);
  const addComment = useAppStore((s) => s.addAlertComment);
  const resolveAlert = useAppStore((s) => s.resolveAlert);
  const createAlert = useAppStore((s) => s.createAlert);
  const flyTo = useAppStore((s) => s.flyToBuilding);

  const [filter, setFilter] = useState<AlertCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "resolved">("active");
  const [sort, setSort] = useState<"recent" | "nearby" | "confirmed">("recent");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [form, setForm] = useState({
    category: "power-outage" as AlertCategory,
    title: "",
    description: "",
    buildingId: "ifri",
    severity: "medium" as "low" | "medium" | "high",
  });

  const filtered = useMemo(() => {
    let list = [...alerts];
    if (filter !== "all") list = list.filter((a) => a.category === filter);
    if (statusFilter !== "all") list = list.filter((a) => a.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.author.toLowerCase().includes(q),
      );
    }
    if (sort === "recent") list.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === "confirmed") list.sort((a, b) => b.confirmations - a.confirmations);
    if (sort === "nearby") list.sort((a, b) => (a.buildingId === "ifri" ? -1 : 0) - (b.buildingId === "ifri" ? -1 : 0));
    return list;
  }, [alerts, filter, statusFilter, query, sort]);

  const counts = useMemo(() => {
    const active = alerts.filter((a) => a.status === "active");
    return {
      active: active.length,
      urgent: active.filter((a) => a.severity === "high").length,
      resolved: alerts.filter((a) => a.status !== "active").length,
      total: alerts.length,
    };
  }, [alerts]);

  const submit = () => {
    if (!form.title.trim() || form.title.trim().length < 4) return;
    createAlert({
      category: form.category,
      title: form.title.trim(),
      description: form.description.trim() || "Aucune description supplémentaire.",
      buildingId: form.buildingId,
      severity: form.severity,
    });
    setCreateOpen(false);
    setForm({ category: "power-outage", title: "", description: "", buildingId: "ifri", severity: "medium" });
  };

  return (
    <div className="min-h-screen">
      {/* header */}
      <div className="border-b border-white/[0.07] bg-gradient-to-b from-[#0b1320] to-transparent px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-danger/25 bg-danger/10 text-danger">
                  <ShieldAlert size={17} />
                </span>
                <div>
                  <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Radar communautaire</h1>
                  <p className="text-[11.5px] text-dim">Alertes signalées par les étudiants du campus</p>
                </div>
              </div>
            </div>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Signaler une alerte
            </Button>
          </div>

          {/* KPI */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Actives", value: counts.active, tone: "warning" as const, icon: AlertTriangle },
              { label: "Urgentes", value: counts.urgent, tone: "danger" as const, icon: ShieldAlert },
              { label: "Résolues", value: counts.resolved, tone: "success" as const, icon: CheckCircle2 },
              { label: "Total signalé", value: counts.total, tone: "neutral" as const, icon: SlidersHorizontal },
            ].map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <Icon size={13} className="text-muted" />
                    <Badge tone={k.tone}>{k.label}</Badge>
                  </div>
                  <p className="mt-1.5 font-display text-[20px] font-bold leading-none text-ink">
                    {String(k.value).padStart(2, "0")}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        {/* toolbar */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(inputClass, "pl-9")}
                placeholder="Rechercher une alerte, un auteur…"
              />
            </div>
            <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-0.5">
              {(["active", "resolved", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium capitalize transition-colors",
                    statusFilter === s ? "bg-white/[0.09] text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {s === "active" ? "Actives" : s === "resolved" ? "Résolues" : "Toutes"}
                </button>
              ))}
            </div>
            <button
              onClick={() =>
                setSort((s) => (s === "recent" ? "confirmed" : s === "confirmed" ? "nearby" : "recent"))
              }
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[11.5px] font-medium text-dim transition-colors hover:text-ink"
            >
              <ArrowUpDown size={12} />
              {sort === "recent" ? "Récence" : sort === "confirmed" ? "Confirmations" : "Proximité"}
            </button>
          </div>

          {/* category chips */}
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === "all"
                  ? "border-cyan/40 bg-cyan/12 text-cyan"
                  : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
              )}
            >
              Toutes
            </button>
            {CATEGORIES.map((c) => {
              const meta = ALERT_META[c];
              const Icon = ICONS[c];
              const active = filter === c;
              const n = alerts.filter((a) => a.category === c && a.status === "active").length;
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active ? "text-ink" : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
                  )}
                  style={active ? { borderColor: `${meta.color}66`, background: `${meta.color}18`, color: meta.color } : undefined}
                >
                  <Icon size={11} />
                  {meta.label}
                  {n > 0 && <span className="rounded-full bg-white/10 px-1 text-[9.5px]">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* list */}
        <div className="mt-4 space-y-2.5">
          {filtered.length === 0 && (
            <EmptyState
              icon={<ShieldAlert size={20} />}
              title="Aucune alerte ne correspond"
              description="Essayez d'élargir les filtres, ou signalez vous-même une information utile au campus."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus size={13} /> Créer une alerte
                </Button>
              }
            />
          )}

          <AnimatePresence initial={false}>
            {filtered.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                expanded={expanded === a.id}
                onToggle={() => setExpanded(expanded === a.id ? null : a.id)}
                onConfirm={() => confirmAlert(a.id)}
                onReport={() => reportAlert(a.id)}
                onResolve={() => resolveAlert(a.id)}
                onComment={(text) => addComment(a.id, text)}
                onLocate={() => flyTo(a.buildingId)}
              />
            ))}
          </AnimatePresence>
        </div>

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-muted">
          Toutes les alertes de cette page sont des données de démonstration. Aucune information réelle du campus
          d&apos;Abomey-Calavi n&apos;est collectée ni publiée.
        </p>
      </div>

      {/* create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Signaler une alerte"
        description="Votre signalement apparaîtra sur la carte et le radar communautaire (simulation)."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" full onClick={submit} disabled={form.title.trim().length < 4}>
              <Send size={14} /> Publier
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Catégorie" required>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((c) => {
                const Icon = ICONS[c];
                const meta = ALERT_META[c];
                const active = form.category === c;
                return (
                  <button
                    key={c}
                    onClick={() => setForm((f) => ({ ...f, category: c }))}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
                      active ? "text-ink" : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
                    )}
                    style={active ? { borderColor: `${meta.color}66`, background: `${meta.color}18`, color: meta.color } : undefined}
                  >
                    <Icon size={11} />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Titre" required hint="Ex. « Coupure d'électricité — Zone IFRI »">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className={inputClass}
              placeholder="Décrivez l'alerte en une phrase"
              maxLength={80}
            />
          </Field>

          <Field label="Localisation" required>
            <select
              value={form.buildingId}
              onChange={(e) => setForm((f) => ({ ...f, buildingId: e.target.value }))}
              className={inputClass}
            >
              {CAMPUS_BUILDINGS.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#0d1422]">
                  {b.shortName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description" hint="Précisez ce que les autres étudiants doivent savoir.">
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={cn(inputClass, "min-h-[76px] resize-none")}
              placeholder="Situation, impact, durée estimée…"
              maxLength={280}
            />
          </Field>

          <Field label="Gravité">
            <div className="flex gap-1.5">
              {(["low", "medium", "high"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setForm((f) => ({ ...f, severity: s }))}
                  className={cn(
                    "flex-1 rounded-lg border py-1.5 text-[11px] font-medium capitalize transition-colors",
                    form.severity === s ? "border-cyan/40 bg-cyan/12 text-cyan" : "border-white/[0.09] bg-white/[0.03] text-muted",
                  )}
                >
                  {s === "low" ? "Faible" : s === "medium" ? "Moyenne" : "Élevée"}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function AlertCard({
  alert,
  expanded,
  onToggle,
  onConfirm,
  onReport,
  onResolve,
  onComment,
  onLocate,
}: {
  alert: CampusAlert;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onReport: () => void;
  onResolve: () => void;
  onComment: (text: string) => void;
  onLocate: () => void;
}) {
  const meta = ALERT_META[alert.category];
  const Icon = ICONS[alert.category];
  const building = BUILDING_BY_ID.get(alert.buildingId);
  const [comment, setComment] = useState("");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "overflow-hidden rounded-2xl border bg-white/[0.025] transition-colors",
        alert.status !== "active" ? "border-white/[0.06] opacity-70" : "border-white/[0.09]",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
          style={{ borderColor: `${meta.color}44`, background: `${meta.color}15`, color: meta.color }}
        >
          <Icon size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {alert.severity === "high" && alert.status === "active" && <Badge tone="danger" dot>Urgent</Badge>}
            {alert.status === "resolved" && <Badge tone="success">Résolue</Badge>}
            {alert.status === "expired" && <Badge tone="neutral">Expirée</Badge>}
          </div>
          <h3 className="mt-0.5 text-[13.5px] font-semibold leading-snug text-ink">{alert.title}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-dim">{alert.description}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
            <button onClick={onLocate} className="flex items-center gap-1 transition-colors hover:text-cyan">
              <MapPin size={10} /> {building?.shortName}
            </button>
            <span className="flex items-center gap-1">
              <Clock size={10} /> {relativeTime(alert.createdAt)}
            </span>
            {alert.status === "active" && (
              <span className="flex items-center gap-1 text-warning/80">
                <AlertTriangle size={10} /> {remainingTime(alert.expiresAt)}
              </span>
            )}
            <span>{alert.author}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={onConfirm}
              disabled={alert.status !== "active"}
              className="flex items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1 text-[10.5px] font-medium text-dim transition-colors hover:border-success/40 hover:text-success disabled:opacity-50"
            >
              <CheckCircle2 size={11} /> Confirmer · {alert.confirmations}
            </button>
            <button
              onClick={onReport}
              disabled={alert.status !== "active"}
              className="flex items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1 text-[10.5px] font-medium text-dim transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-50"
            >
              <Flag size={11} /> Signaler · {alert.reports}
            </button>
            <button
              onClick={onToggle}
              className="flex items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1 text-[10.5px] font-medium text-dim transition-colors hover:border-cyan/40 hover:text-cyan"
            >
              <MessageSquare size={11} /> {alert.comments.length}
            </button>
            {alert.status === "active" && (
              <button
                onClick={onResolve}
                className="ml-auto flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] text-muted transition-colors hover:text-success"
              >
                Marquer résolue
              </button>
            )}
          </div>

          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-2 overflow-hidden">
              <div className="space-y-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                {alert.comments.length === 0 && (
                  <p className="text-[11px] text-muted">Aucun commentaire. Soyez le premier à réagir.</p>
                )}
                {alert.comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                    <p className="text-[10.5px] font-semibold text-ink">{c.author}</p>
                    <p className="text-[11.5px] leading-relaxed text-dim">{c.text}</p>
                  </div>
                ))}
                <div className="flex gap-1.5 pt-0.5">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && comment.trim()) {
                        onComment(comment.trim());
                        setComment("");
                      }
                    }}
                    className={cn(inputClass, "py-1.5 text-[11.5px]")}
                    placeholder="Ajouter un commentaire…"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (comment.trim()) {
                        onComment(comment.trim());
                        setComment("");
                      }
                    }}
                  >
                    <Send size={12} />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <Link
        href="/map"
        onClick={onLocate}
        className="flex items-center justify-between border-t border-white/[0.06] px-3.5 py-1.5 text-[10.5px] text-muted transition-colors hover:bg-white/[0.03] hover:text-cyan"
      >
        Voir sur la carte 3D
        <Navigation2 size={11} />
      </Link>
    </motion.div>
  );
}
