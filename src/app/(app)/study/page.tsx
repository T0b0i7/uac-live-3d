"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  CalendarClock,
  Check,
  Clock,
  DoorOpen,
  GraduationCap,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { BUILDING_BY_ID, CAMPUS_BUILDINGS } from "@/data/buildings";
import { STUDY_SUBJECTS } from "@/data/social";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Badge, Button, EmptyState, Field, inputClass, Meter, Modal } from "@/components/ui/primitives";
import { cn, formatTime, hashString } from "@/lib/utils";

const SUBJECT_FILTERS = ["Tous", "Informatique", "Mathématiques", "Droit", "Sciences", "Lettres"];

function subjectTone(subject: string) {
  const h = hashString(subject) % 4;
  return [
    { color: "#35D6F5", bg: "rgba(53,214,245,0.12)" },
    { color: "#8B5CF6", bg: "rgba(139,92,246,0.14)" },
    { color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
    { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  ][h]!;
}

export default function StudyPage() {
  const groups = useAppStore((s) => s.groups);
  const joinGroup = useAppStore((s) => s.joinGroup);
  const leaveGroup = useAppStore((s) => s.leaveGroup);
  const createGroup = useAppStore((s) => s.createGroup);
  const flyTo = useAppStore((s) => s.flyToBuilding);

  const [filter, setFilter] = useState("Tous");
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    topic: "",
    buildingId: "ifri",
    room: "",
    capacity: 12,
    durationMin: 90,
    department: "Génie Logiciel",
    tags: "Révisions",
  });

  const filtered = useMemo(() => {
    let list = [...groups];
    if (filter !== "Tous") {
      list = list.filter(
        (g) =>
          g.subject.toLowerCase().includes(filter.toLowerCase()) ||
          g.department.toLowerCase().includes(filter.toLowerCase()) ||
          g.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())),
      );
    }
    if (onlyOpen) list = list.filter((g) => g.participants < g.capacity);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (g) =>
          g.subject.toLowerCase().includes(q) ||
          g.topic.toLowerCase().includes(q) ||
          g.organizer.toLowerCase().includes(q) ||
          g.room.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => a.startTime - b.startTime);
  }, [groups, filter, onlyOpen, query]);

  const joined = groups.filter((g) => g.joined);

  const submit = () => {
    if (!form.subject.trim() || !form.room.trim()) return;
    createGroup({
      subject: form.subject.trim(),
      topic: form.topic.trim() || "Session de travail",
      buildingId: form.buildingId,
      room: form.room.trim(),
      capacity: form.capacity,
      durationMin: form.durationMin,
      department: form.department,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setCreateOpen(false);
    setForm({ subject: "", topic: "", buildingId: "ifri", room: "", capacity: 12, durationMin: 90, department: "Génie Logiciel", tags: "Révisions" });
  };

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/[0.07] bg-gradient-to-b from-[#0b1320] to-transparent px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-violet/30 bg-violet/12 text-[#b79cff]">
                <GraduationCap size={17} />
              </span>
              <div>
                <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Study Spots & Groupes</h1>
                <p className="text-[11.5px] text-dim">Rejoignez une session de travail près de vous</p>
              </div>
            </div>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> Créer un groupe
            </Button>
          </div>

          {joined.length > 0 && (
            <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/[0.07] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan">
                <Check size={11} /> Vous participez à {joined.length} session{joined.length > 1 ? "s" : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {joined.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => flyTo(g.buildingId)}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[10.5px] text-dim transition-colors hover:text-ink"
                  >
                    {g.subject} · {formatTime(g.startTime)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(inputClass, "pl-9")}
                placeholder="Rechercher une matière, une salle, un organisateur…"
              />
            </div>
            <button
              onClick={() => setOnlyOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11.5px] font-medium transition-colors",
                onlyOpen
                  ? "border-cyan/40 bg-cyan/12 text-cyan"
                  : "border-white/[0.08] bg-white/[0.03] text-dim hover:text-ink",
              )}
            >
              <DoorOpen size={12} /> Places disponibles
            </button>
          </div>

          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {SUBJECT_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === f
                    ? "border-violet/50 bg-violet/15 text-[#c4aeff]"
                    : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && (
            <div className="sm:col-span-2 xl:col-span-3">
              <EmptyState
                icon={<BookOpen size={20} />}
                title="Aucun groupe trouvé"
                description="Aucune session ne correspond à ces filtres. Créez la vôtre et invitez vos camarades."
                action={
                  <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus size={13} /> Créer un groupe
                  </Button>
                }
              />
            </div>
          )}

          <AnimatePresence initial={false}>
            {filtered.map((g) => {
              const b = BUILDING_BY_ID.get(g.buildingId);
              const tone = subjectTone(g.subject);
              const remaining = g.capacity - g.participants;
              const isPast = g.startTime < Date.now() && g.status !== "ongoing";
              return (
                <motion.article
                  key={g.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  className="group flex flex-col rounded-2xl border border-white/[0.09] bg-white/[0.025] p-3.5 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                      style={{ background: tone.bg, color: tone.color }}
                    >
                      <BookOpen size={15} />
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {g.status === "ongoing" && <Badge tone="danger" dot>En cours</Badge>}
                      {g.status === "full" && <Badge tone="warning">Complet</Badge>}
                      {g.joined && <Badge tone="success">Inscrit</Badge>}
                    </div>
                  </div>

                  <h3 className="mt-2 text-[13.5px] font-semibold leading-snug text-ink">{g.subject}</h3>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-dim">{g.topic}</p>

                  <div className="mt-2 space-y-1 text-[10.5px] text-muted">
                    <button onClick={() => flyTo(g.buildingId)} className="flex items-center gap-1 transition-colors hover:text-cyan">
                      <MapPin size={10} /> {b?.shortName} · {g.room}
                    </button>
                    <p className="flex items-center gap-1">
                      <CalendarClock size={10} /> {formatTime(g.startTime)} · {g.durationMin} min
                    </p>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <Avatar
                      initials={g.organizer.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      seed={g.organizer}
                      size={24}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10.5px] font-medium text-ink">{g.organizer}</p>
                      <p className="truncate text-[9.5px] text-muted">{g.department}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-dim">
                      <Users size={10} /> {g.participants}/{g.capacity}
                    </span>
                  </div>

                  <Meter value={g.participants} max={g.capacity} height={4} className="mt-1.5" tone={remaining === 0 ? "warning" : "violet"} />

                  <div className="mt-2.5 flex items-center gap-1.5">
                    {g.joined ? (
                      <Button size="sm" variant="secondary" full onClick={() => leaveGroup(g.id)}>
                        <LogOut size={12} /> Quitter
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={remaining === 0 ? "secondary" : "primary"}
                        full
                        disabled={remaining === 0 || isPast}
                        onClick={() => joinGroup(g.id)}
                      >
                        <LogIn size={12} /> {remaining === 0 ? "Complet" : "Rejoindre"}
                      </Button>
                    )}
                    <Link href="/map">
                      <Button size="sm" variant="ghost" onClick={() => flyTo(g.buildingId)} aria-label="Voir sur la carte">
                        <MapPin size={12} />
                      </Button>
                    </Link>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-muted">
          Les groupes et participants sont simulés. Aucune invitation réelle n&apos;est envoyée.
        </p>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Créer un groupe d'étude"
        description="Votre session sera visible sur le campus et la carte 3D (simulation)."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" full onClick={submit} disabled={!form.subject.trim() || !form.room.trim()}>
              <Sparkles size={14} /> Créer
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Matière / sujet" required>
            <input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              className={inputClass}
              placeholder="Ex. Algorithmique — Java"
              maxLength={50}
            />
          </Field>
          <Field label="Thème de la session">
            <input
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              className={inputClass}
              placeholder="Ex. Structures de données et complexité"
              maxLength={80}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Bâtiment" required>
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
            <Field label="Salle" required>
              <input
                value={form.room}
                onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
                className={inputClass}
                placeholder="Salle TP 2"
                maxLength={30}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Places">
              <input
                type="number"
                min={2}
                max={40}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: Math.max(2, Math.min(40, Number(e.target.value))) }))}
                className={inputClass}
              />
            </Field>
            <Field label="Durée (min)">
              <select
                value={form.durationMin}
                onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))}
                className={inputClass}
              >
                {[45, 60, 75, 90, 120, 150, 180].map((d) => (
                  <option key={d} value={d} className="bg-[#0d1422]">
                    {d} min
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Département">
            <select
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              className={inputClass}
            >
              {STUDY_SUBJECTS.map((s) => (
                <option key={s} value={s} className="bg-[#0d1422]">
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags" hint="Séparés par des virgules">
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              className={inputClass}
              placeholder="Révisions, Examen"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
