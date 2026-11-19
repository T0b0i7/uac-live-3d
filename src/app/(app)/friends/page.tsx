"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
  Sparkles,
  MessageSquare,
  MapPin,
  Filter,
} from "lucide-react";
import { CAMPUS_STUDENTS, STATUS_META } from "@/data/students";
import { BUILDING_BY_ID } from "@/data/buildings";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Badge, Button, EmptyState, inputClass } from "@/components/ui/primitives";
import { StudentProfileModal } from "@/components/buildings/BuildingDrawer";
import { cn } from "@/lib/utils";

const FACULTY_FILTERS = [
  "Toutes",
  "IFRI — Informatique",
  "FAST — Sciences et Techniques",
  "FADESP — Droit et Science Politique",
  "FLSH — Lettres et Sciences Humaines",
  "FSA — Sciences Agronomiques",
];

export default function FriendsPage() {
  const friends = useAppStore((s) => s.friends);
  const requests = useAppStore((s) => s.friendRequests);
  const sent = useAppStore((s) => s.sentRequests);
  const accept = useAppStore((s) => s.acceptFriendRequest);
  const decline = useAppStore((s) => s.declineFriendRequest);
  const removeFriend = useAppStore((s) => s.removeFriend);
  const sendRequest = useAppStore((s) => s.sendFriendRequest);
  const pushToast = useAppStore((s) => s.pushToast);

  const [tab, setTab] = useState<"friends" | "requests" | "discover">("friends");
  const [query, setQuery] = useState("");
  const [faculty, setFaculty] = useState("Toutes");
  const [studentId, setStudentId] = useState<string | null>(null);

  const friendList = useMemo(
    () => CAMPUS_STUDENTS.filter((s) => friends.includes(s.id)),
    [friends],
  );

  const suggestions = useMemo(
    () =>
      CAMPUS_STUDENTS.filter(
        (s) => !friends.includes(s.id) && !sent.includes(s.id) && !requests.some((r) => r.studentId === s.id),
      ),
    [friends, sent, requests],
  );

  const applyFilters = (list: typeof CAMPUS_STUDENTS) =>
    list.filter((s) => {
      const matchQ =
        !query.trim() ||
        s.fullName.toLowerCase().includes(query.toLowerCase()) ||
        s.department.toLowerCase().includes(query.toLowerCase());
      const matchF = faculty === "Toutes" || s.faculty === faculty;
      return matchQ && matchF;
    });

  const shown =
    tab === "friends" ? applyFilters(friendList) : tab === "discover" ? applyFilters(suggestions) : [];

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/[0.07] bg-gradient-to-b from-[#0b1320] to-transparent px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan/30 bg-cyan/12 text-cyan">
              <Users size={17} />
            </span>
            <div>
              <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Mon réseau campus</h1>
              <p className="text-[11.5px] text-dim">
                {friendList.length} amis · {requests.length} demande{requests.length > 1 ? "s" : ""} en attente
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-1 border-b border-white/[0.07]">
            {(
              [
                { k: "friends", label: "Amis", count: friendList.length },
                { k: "requests", label: "Demandes", count: requests.length },
                { k: "discover", label: "Découvrir", count: suggestions.length },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors",
                  tab === t.k ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px]",
                    tab === t.k ? "bg-cyan/20 text-cyan" : "bg-white/[0.07] text-muted",
                  )}
                >
                  {t.count}
                </span>
                {tab === t.k && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-cyan" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        {tab !== "requests" && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(inputClass, "pl-9")}
                placeholder="Rechercher un étudiant, un département…"
              />
            </div>
            <div className="relative">
              <Filter size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <select
                value={faculty}
                onChange={(e) => setFaculty(e.target.value)}
                className={cn(inputClass, "w-auto min-w-[180px] py-2 pl-7 text-[11.5px]")}
              >
                {FACULTY_FILTERS.map((f) => (
                  <option key={f} value={f} className="bg-[#0d1422]">
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* requests */}
        {tab === "requests" && (
          <div className="space-y-2.5">
            {requests.length === 0 && (
              <EmptyState
                icon={<UserPlus size={20} />}
                title="Aucune demande en attente"
                description="Les nouvelles demandes de connexion apparaîtront ici."
              />
            )}
            <AnimatePresence initial={false}>
              {requests.map((r) => {
                const s = CAMPUS_STUDENTS.find((x) => x.id === r.studentId);
                if (!s) return null;
                return (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.025] p-3.5"
                  >
                    <button onClick={() => setStudentId(s.id)}>
                      <Avatar initials={s.initials} seed={s.avatarSeed} size={44} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink">{s.fullName}</p>
                      <p className="text-[11px] text-muted">
                        {s.department} · {s.level}
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-dim">« {r.message} »</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="success" onClick={() => accept(r.id)}>
                        <Check size={12} /> Accepter
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => decline(r.id)}>
                        <X size={12} />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* grid */}
        {tab !== "requests" && (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.length === 0 && (
              <div className="sm:col-span-2 lg:col-span-3">
                <EmptyState
                  icon={<Users size={20} />}
                  title={tab === "friends" ? "Aucun ami pour ces filtres" : "Aucune suggestion"}
                  description={
                    tab === "friends"
                      ? "Modifiez vos filtres ou découvrez de nouveaux étudiants sur le campus."
                      : "Vous avez déjà envoyé des demandes à tous les profils suggérés."
                  }
                    />
              </div>
            )}

            <AnimatePresence initial={false}>
              {shown.map((s) => {
                const b = BUILDING_BY_ID.get(s.buildingId);
                const isFriend = friends.includes(s.id);
                const isSent = sent.includes(s.id);
                return (
                  <motion.article
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="group overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.025] transition-colors hover:border-white/[0.16]"
                  >
                    <div className="relative h-14 overflow-hidden bg-gradient-to-br from-cyan/15 via-[#0d2233] to-violet/15">
                      <div className="absolute inset-0 map-grid-lines opacity-30" />
                      {s.online && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#04121b]/70 px-1.5 py-0.5 text-[9px] font-medium text-success backdrop-blur">
                          <span className="h-1 w-1 animate-pulse rounded-full bg-success" /> en ligne
                        </span>
                      )}
                    </div>
                    <div className="-mt-6 px-3.5 pb-3.5">
                      <button onClick={() => setStudentId(s.id)} className="relative">
                        <Avatar initials={s.initials} seed={s.avatarSeed} size={48} ring status={s.online ? "online" : "offline"} />
                      </button>
                      <div className="mt-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button onClick={() => setStudentId(s.id)} className="block truncate text-left text-[13px] font-semibold text-ink hover:text-cyan">
                            {s.fullName}
                          </button>
                          <p className="truncate text-[11px] text-muted">
                            {s.department} · {s.level}
                          </p>
                        </div>
                        <Badge tone="violet">
                          <Sparkles size={8} /> {s.reputation}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
                          style={{
                            background: `${STATUS_META[s.status].color}18`,
                            color: STATUS_META[s.status].color,
                          }}
                        >
                          <span className="h-1 w-1 rounded-full bg-current" />
                          {STATUS_META[s.status].label}
                        </span>
                        {b && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] text-muted">
                            <MapPin size={8} /> {b.shortName}
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex gap-1.5">
                        {isFriend ? (
                          <>
                            <Button size="sm" variant="secondary" full onClick={() => removeFriend(s.id)}>
                              <UserMinus size={12} /> Retirer
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                pushToast({
                                  title: "Messagerie simulée",
                                  description: `Aucun message réel n'est envoyé à ${s.fullName}.`,
                                  tone: "info",
                                })
                              }
                              aria-label="Message"
                            >
                              <MessageSquare size={12} />
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="primary" full disabled={isSent} onClick={() => sendRequest(s.id)}>
                            {isSent ? (
                              <>Demande envoyée</>
                            ) : (
                              <>
                                <Check size={12} /> Se connecter
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-muted">
          25 profils étudiants simulés · aucune donnée personnelle réelle n&apos;est utilisée.
        </p>
      </div>

      <StudentProfileModal studentId={studentId} onClose={() => setStudentId(null)} />
    </div>
  );
}
