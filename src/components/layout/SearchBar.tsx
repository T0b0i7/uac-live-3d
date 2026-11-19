"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X, CornerDownLeft, Building2, UserRound, Clock, Sparkles } from "lucide-react";
import { CAMPUS_BUILDINGS, CATEGORY_META } from "@/data/buildings";
import { CAMPUS_STUDENTS } from "@/data/students";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Result =
  | { kind: "building"; id: string; title: string; subtitle: string; color: string }
  | { kind: "student"; id: string; title: string; subtitle: string; seed: string; initials: string };

export function SearchBar({
  variant = "floating",
  onOpenProfile,
}: {
  variant?: "floating" | "inline";
  onOpenProfile?: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectBuilding = useAppStore((s) => s.selectBuilding);
  const flyTo = useAppStore((s) => s.flyToBuilding);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const recent = useAppStore((s) => s.recentSearches);
  const pushRecent = useAppStore((s) => s.pushRecentSearch);

  useEffect(() => {
    setSearchQuery(q);
  }, [q, setSearchQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results: Result[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const b: Result[] = CAMPUS_BUILDINGS.filter(
      (x) =>
        x.name.toLowerCase().includes(term) ||
        x.shortName.toLowerCase().includes(term) ||
        CATEGORY_META[x.category].label.toLowerCase().includes(term) ||
        x.rooms.some((r) => r.name.toLowerCase().includes(term)) ||
        x.amenities.some((a) => a.toLowerCase().includes(term)),
    )
      .slice(0, 6)
      .map((x) => ({
        kind: "building",
        id: x.id,
        title: x.shortName,
        subtitle: [x.rooms.find((r) => r.name.toLowerCase().includes(term))?.name, CATEGORY_META[x.category].label]
          .filter(Boolean)
          .join(" · "),
        color: CATEGORY_META[x.category].color,
      }));

    const s: Result[] = CAMPUS_STUDENTS.filter(
      (x) =>
        x.fullName.toLowerCase().includes(term) ||
        x.department.toLowerCase().includes(term) ||
        x.faculty.toLowerCase().includes(term),
    )
      .slice(0, 5)
      .map((x) => ({
        kind: "student",
        id: x.id,
        title: x.fullName,
        subtitle: `${x.department} · ${x.level}`,
        seed: x.avatarSeed,
        initials: x.initials,
      }));

    return [...b, ...s];
  }, [q]);

  const goBuilding = (id: string, title: string) => {
    pushRecent(title);
    if (pathname !== "/map") {
      router.push("/map");
      setTimeout(() => flyTo(id), 320);
    } else {
      flyTo(id);
    }
    setOpen(false);
    setQ("");
  };

  const wrapper = variant === "floating" ? "w-full max-w-xl" : "w-full";

  return (
    <div ref={wrapRef} className={cn("relative z-40", wrapper)}>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-2xl border px-3.5 transition-all duration-300",
          "border-white/[0.1] bg-white/[0.055] backdrop-blur-2xl",
          open && "border-cyan/40 bg-white/[0.075] shadow-[0_0_0_3px_rgba(53,214,245,0.1),0_20px_50px_-24px_rgba(2,6,23,0.9)]",
        )}
      >
        <Search size={16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un bâtiment, une salle, un étudiant…"
          className="h-11 w-full bg-transparent text-[13.5px] text-ink placeholder:text-muted/80 focus:outline-none"
          aria-label="Recherche campus"
        />
        {q ? (
          <button
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-ink"
            aria-label="Effacer"
          >
            <X size={13} />
          </button>
        ) : (
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0a1220]/96 shadow-[0_30px_70px_-30px_rgba(2,6,23,0.95)] backdrop-blur-2xl">
          {!q && (
            <div className="p-2.5">
              <p className="flex items-center gap-1.5 px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                <Clock size={11} /> Recherches récentes
              </p>
              {recent.length === 0 && <p className="px-2 py-2 text-[12.5px] text-dim">Aucune recherche récente.</p>}
              {recent.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setQ(r);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-dim transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  <Clock size={13} className="text-muted" />
                  {r}
                </button>
              ))}
              <div className="mt-1.5 border-t border-white/[0.07] pt-2">
                <p className="flex items-center gap-1.5 px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Sparkles size={11} /> Suggestions
                </p>
                {["IFRI", "Bibliothèque", "Amphi A1", "Restaurant Universitaire"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setQ(s)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] text-dim transition-colors hover:bg-white/[0.06] hover:text-ink"
                  >
                    <Search size={13} className="text-muted" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {q && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] font-medium text-ink">Aucun résultat pour « {q} »</p>
              <p className="mt-1 text-[12px] text-dim">Essayez « IFRI », « bibliothèque » ou un nom d&apos;étudiant.</p>
            </div>
          )}

          {q && results.length > 0 && (
            <div className="thin-scroll max-h-[380px] overflow-y-auto p-2">
              {results.map((r) => (
                <button
                  key={`${r.kind}-${r.id}`}
                  onClick={() => {
                    if (r.kind === "building") goBuilding(r.id, r.title);
                    else {
                      setOpen(false);
                      pushRecent(r.title);
                      if (onOpenProfile) onOpenProfile(r.id);
                      else {
                        const el = document.querySelector<HTMLElement>(`[data-student="${r.id}"]`);
                        el?.click();
                        if (!el) router.push("/friends");
                      }
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.07]"
                >
                  {r.kind === "building" ? (
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
                      style={{ borderColor: `${r.color}44`, background: `${r.color}14`, color: r.color }}
                    >
                      <Building2 size={14} />
                    </span>
                  ) : (
                    <Avatar initials={r.initials} seed={r.seed} size={32} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[11.5px] text-dim">{r.subtitle}</span>
                  </span>
                  <span className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-muted">
                    {r.kind === "building" ? "Bâtiment" : "Étudiant"}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2 text-[10.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <CornerDownLeft size={11} /> Sélectionner
            </span>
            <span>Données de démonstration</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function QuickLinksInline() {
  return (
    <Link href="/map" className="text-[12px] text-cyan hover:underline">
      Carte
    </Link>
  );
}
