"use client";

/**
 * Panneau de détail d'un bâtiment — apps/web/src/components/map/BuildingDetail.tsx
 *
 * Toutes les valeurs affichées viennent de la réponse `/buildings/:id`.
 * Aucune valeur n'est estimée : quand un champ est absent (`null`), la ligne
 * n'est pas affichée du tout plutôt que remplie par une valeur plausible.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  CalendarCheck,
  CheckCircle2,
  Compass,
  Layers,
  Ruler,
  ShieldQuestion,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Building } from "@uac/contracts";
import { useBuilding, useBuildingRooms } from "@/lib/hooks";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";

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

const SOURCE_LABELS: Record<string, string> = {
  INSTITUTIONAL: "Institutionnelle",
  FIELD_SURVEY: "Relevé terrain",
  CONTRIBUTED: "Contribution",
  IMPORTED: "Import",
};

function formatArea(value: number | null): string | null {
  if (value === null || value === undefined) return null;
  return `${Math.round(value).toLocaleString("fr-FR")} m²`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export function BuildingDetail({
  buildingId,
  fallback,
  onClose,
  onNavigate,
}: {
  buildingId: string;
  /** Donnée déjà chargée par la liste : évite un écran blanc pendant le fetch. */
  fallback?: Building;
  onClose: () => void;
  onNavigate: (building: Building) => void;
}) {
  const detail = useBuilding(buildingId);
  const rooms = useBuildingRooms(buildingId);
  const [confirmNavigate, setConfirmNavigate] = useState(false);

  const building = detail.data ?? fallback;

  useEffect(() => {
    setConfirmNavigate(false);
  }, [buildingId]);

  const roomSummary = useMemo(() => {
    const list = rooms.data;
    if (!list || list.length === 0) return null;
    const capacity = list.reduce((sum, room) => sum + room.capacity, 0);
    const accessible = list.filter((room) => room.isAccessible).length;
    return { count: list.length, capacity, accessible };
  }, [rooms.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
            {building?.code ?? "…"}
          </p>
          <h2 className="mt-0.5 truncate text-sm font-semibold text-ink">
            {building?.name ?? "Chargement…"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-line p-1.5 text-muted transition hover:text-ink"
          aria-label="Fermer la fiche"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {detail.isError && !fallback ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} compact />
        ) : null}

        {!building ? (
          <div className="space-y-2.5">
            <SkeletonBlock className="h-3 w-full" />
            <SkeletonBlock className="h-3 w-4/5" />
            <SkeletonBlock className="h-3 w-2/3" />
          </div>
        ) : (
          <>
            {building.description ? (
              <p className="mb-4 text-xs leading-relaxed text-muted">{building.description}</p>
            ) : null}

            <dl className="space-y-2.5">
              <Row label="Catégorie" value={CATEGORY_LABELS[building.category] ?? building.category} />
              <Row label="Faculté" value={building.facultyName} />
              <Row label="Niveaux" value={`${building.floors}`} />
              <Row
                label="Emprise au sol"
                value={formatArea(building.footprintAreaM2)}
                icon={<Ruler size={12} />}
              />
              <Row
                label="Source"
                value={SOURCE_LABELS[building.source] ?? building.source}
                icon={<ShieldQuestion size={12} />}
              />
              <Row
                label="Dernière vérification"
                value={formatDate(building.lastVerifiedAt)}
                icon={<CalendarCheck size={12} />}
              />
              <Row
                label="Géométrie"
                value={
                  building.geometry
                    ? `Polygone · ${building.geometry.coordinates[0]?.length ?? 0} sommets`
                    : "Non géoréférencé"
                }
                icon={<Layers size={12} />}
                tone={building.geometry ? "ok" : "warn"}
              />
            </dl>

            {/* Salles */}
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">Salles</p>
              {rooms.isLoading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-8 w-full" />
                  <SkeletonBlock className="h-8 w-full" />
                </div>
              ) : rooms.isError ? (
                <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} compact />
              ) : !rooms.data || rooms.data.length === 0 ? (
                <p className="text-xs text-muted/80">
                  Aucune salle enregistrée pour ce bâtiment.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-[11px] text-muted/80">
                    {roomSummary!.count} salle{roomSummary!.count > 1 ? "s" : ""} ·{" "}
                    {roomSummary!.capacity.toLocaleString("fr-FR")} places ·{" "}
                    {roomSummary!.accessible} accessible{roomSummary!.accessible > 1 ? "s" : ""}
                  </p>
                  <ul className="space-y-1.5">
                    {rooms.data.slice(0, 12).map((room) => (
                      <li
                        key={room.id}
                        className="flex items-center justify-between rounded-lg border border-line/70 bg-secondary/60 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 truncate text-xs text-ink">
                          <span className="font-mono text-[10px] text-primary">{room.code}</span>
                          {" · "}
                          {room.name}
                        </span>
                        <span className="ml-2 flex shrink-0 items-center gap-2 text-[10px] text-muted">
                          {room.capacity} pl.
                          {room.isAccessible ? (
                            <Accessibility size={11} className="text-ok" />
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {rooms.data.length > 12 ? (
                    <p className="mt-2 text-[10px] text-muted/60">
                      + {rooms.data.length - 12} autres salles
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {building.verificationStatus !== "VERIFIED" ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-[11px] text-warn">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                <span>
                  Information non vérifiée institutionnellement
                  {building.verificationStatus === "PENDING" ? " (en attente)" : ""}.
                </span>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/8 px-3 py-2 text-[11px] text-ok">
                <CheckCircle2 size={13} /> Bâtiment vérifié
              </div>
            )}

            {building.centroid ? (
              <p className="mt-3 font-mono text-[10px] text-muted/60">
                {building.centroid.lat.toFixed(6)}, {building.centroid.lng.toFixed(6)}
              </p>
            ) : null}
          </>
        )}
      </div>

      {building ? (
        <div className="border-t border-line px-4 py-3">
          {confirmNavigate ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted">
                Calculer un itinéraire jusqu'à <strong className="text-ink">{building.name}</strong> ?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(building);
                    setConfirmNavigate(false);
                  }}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-[#04121a] transition hover:brightness-110"
                >
                  Calculer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmNavigate(false)}
                  className="rounded-lg border border-line px-3 py-2 text-xs text-muted transition hover:text-ink"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmNavigate(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/18"
            >
              <Compass size={13} /> Itinéraire vers ce bâtiment
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | null;
  icon?: React.ReactNode;
  tone?: "ok" | "warn";
}) {
  if (value === null || value === undefined || value === "") return null;
  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
        {icon}
        {label}
      </dt>
      <dd className={`min-w-0 truncate text-right text-xs font-medium ${toneClass}`}>{value}</dd>
    </div>
  );
}
