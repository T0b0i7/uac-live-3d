"use client";

/**
 * Liste des bâtiments — apps/web/src/app/buildings/page.tsx
 *
 * Filtres facultatifs appliqués côté serveur quand c'est possible
 * (`search`, `facultyId`), sinon en mémoire sur le jeu déjà chargé. Aucun
 * résultat n'est fabriqué : une liste vide affiche un état vide explicite.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, MapPin, Ruler, Search, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, LoadingCards } from "@/components/ui/States";
import { useBuildings, useFaculties } from "@/lib/hooks";

const CATEGORY_LABELS: Record<string, string> = {
  AMPHITHEATER: "Amphithéâtre",
  CLASSROOM_BUILDING: "Bâtiment de cours",
  LABORATORY: "Laboratoire",
  LIBRARY: "Bibliothèque",
  ADMINISTRATION: "Administration",
  RESTAURANT: "Restauration",
  RESIDENCE: "Résidence",
  SPORTS: "Sport",
  OTHER: "Autre",
};

export default function BuildingsPage() {
  const [search, setSearch] = useState("");
  const [facultyId, setFacultyId] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [onlyGeoreferenced, setOnlyGeoreferenced] = useState(false);

  const buildingsQuery = useBuildings({ limit: 100 });
  const facultiesQuery = useFaculties();

  const buildings = buildingsQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return buildings.filter((b) => {
      if (facultyId && b.facultyId !== facultyId) return false;
      if (category && b.category !== category) return false;
      if (onlyGeoreferenced && !b.geometry) return false;
      if (!term) return true;
      return [b.name, b.code, b.shortName, b.facultyName].some((v) =>
        v ? v.toLowerCase().includes(term) : false,
      );
    });
  }, [buildings, search, facultyId, category, onlyGeoreferenced]);

  const categories = useMemo(
    () => Array.from(new Set(buildings.map((b) => b.category))).sort(),
    [buildings],
  );

  return (
    <AppShell
      title="Bâtiments du campus"
      subtitle={
        buildingsQuery.data
          ? `${filtered.length} affiché${filtered.length > 1 ? "s" : ""} sur ${buildingsQuery.data.meta.total}`
          : "Chargement…"
      }
    >
      {/* Filtres */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, code ou faculté…"
            className="w-full rounded-lg border border-line bg-secondary py-2 pl-8 pr-3 text-xs text-ink placeholder:text-muted/60 focus:border-primary/60 focus:outline-none"
          />
        </div>

        <select
          value={facultyId}
          onChange={(e) => setFacultyId(e.target.value)}
          className="rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-ink focus:border-primary/60 focus:outline-none"
        >
          <option value="">Toutes les facultés</option>
          {(facultiesQuery.data ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.shortName ?? f.name}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-ink focus:border-primary/60 focus:outline-none"
        >
          <option value="">Toutes catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-secondary px-2.5 py-2 text-xs text-muted">
          <SlidersHorizontal size={12} />
          Géoréférencés
          <input
            type="checkbox"
            checked={onlyGeoreferenced}
            onChange={(e) => setOnlyGeoreferenced(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#35D6F5]"
          />
        </label>
      </div>

      {/* Contenu */}
      {buildingsQuery.isLoading ? (
        <LoadingCards count={6} />
      ) : buildingsQuery.isError ? (
        <ErrorState error={buildingsQuery.error} onRetry={() => void buildingsQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Aucun bâtiment ne correspond"
          description={
            buildings.length === 0
              ? "La base ne contient aucun bâtiment."
              : "Ajustez la recherche ou retirez un filtre."
          }
          icon={<Building2 size={26} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((building) => (
            <Link
              key={building.id}
              href={`/buildings/${building.id}`}
              className="group rounded-xl2 border border-line bg-surface/60 p-4 transition hover:border-primary/50 hover:bg-surface"
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                  {building.code}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    building.verificationStatus === "VERIFIED"
                      ? "bg-ok/15 text-ok"
                      : "bg-warn/15 text-warn"
                  }`}
                >
                  {building.verificationStatus === "VERIFIED" ? "vérifié" : "à vérifier"}
                </span>
              </div>

              <h2 className="mb-1 line-clamp-2 text-sm font-semibold leading-snug text-ink group-hover:text-primary">
                {building.name}
              </h2>

              <p className="mb-3 text-[11px] text-muted">
                {CATEGORY_LABELS[building.category] ?? building.category}
                {building.facultyName ? ` · ${building.facultyName}` : ""}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <MapPin size={10} />
                  {building.geometry ? "Emprise disponible" : "Sans emprise"}
                </span>
                {building.footprintAreaM2 !== null ? (
                  <span className="flex items-center gap-1">
                    <Ruler size={10} />
                    {Math.round(building.footprintAreaM2).toLocaleString("fr-FR")} m²
                  </span>
                ) : null}
                <span>{building.floors} niveau{building.floors > 1 ? "x" : ""}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
