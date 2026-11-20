"use client";

/**
 * Signalements — apps/web/src/app/reports/page.tsx
 *
 * Lecture seule pour l'instant : le formulaire de création exige un compte
 * (ADR-005) et n'est pas branché ici. On n'affiche donc pas de bouton inactif
 * qui laisserait croire que la création fonctionne.
 */

import { useMemo, useState } from "react";
import { MapPin, MessageSquare, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, LoadingCards } from "@/components/ui/States";
import { useReports } from "@/lib/hooks";

const CATEGORY_LABELS: Record<string, string> = {
  SAFETY: "Sécurité",
  INFRASTRUCTURE: "Infrastructure",
  ACCESSIBILITY: "Accessibilité",
  SANITATION: "Propreté",
  SECURITY: "Sûreté",
  OTHER: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  RESOLVED: "Résolu",
  EXPIRED: "Expiré",
  HIDDEN: "Masqué",
};

const SEVERITY_COLORS = [
  "bg-muted",
  "bg-ok",
  "bg-primary",
  "bg-warn",
  "bg-warn",
  "bg-danger",
] as const;

export default function ReportsPage() {
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"recent" | "confirmations" | "severity">("recent");

  const reportsQuery = useReports({
    limit: 30,
    ...(category ? { category } : {}),
    sort,
  });

  const reports = reportsQuery.data?.items ?? [];

  const categories = useMemo(
    () => Array.from(new Set(reports.map((r) => r.category))).sort(),
    [reports],
  );

  return (
    <AppShell
      title="Signalements"
      subtitle={
        reportsQuery.data
          ? `${reportsQuery.data.meta.total} signalement${reportsQuery.data.meta.total > 1 ? "s" : ""} actifs sur le campus`
          : "Chargement…"
      }
      actions={
        <>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink focus:border-primary/60 focus:outline-none"
          >
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-ink focus:border-primary/60 focus:outline-none"
          >
            <option value="recent">Plus récents</option>
            <option value="confirmations">Plus confirmés</option>
            <option value="severity">Plus graves</option>
          </select>
        </>
      }
    >
      {reportsQuery.isLoading ? (
        <LoadingCards count={4} />
      ) : reportsQuery.isError ? (
        <ErrorState error={reportsQuery.error} onRetry={() => void reportsQuery.refetch()} />
      ) : reports.length === 0 ? (
        <EmptyState
          title="Aucun signalement"
          description="Aucun signalement actif ne correspond à ce filtre. La base est vide pour ces critères."
          icon={<TriangleAlert size={26} />}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reports.map((report) => (
            <article
              key={report.id}
              className="rounded-xl2 border border-line bg-surface/60 p-4"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        SEVERITY_COLORS[report.severity] ?? "bg-muted"
                      }`}
                      title={`Sévérité ${report.severity}/5`}
                    />
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {CATEGORY_LABELS[report.category] ?? report.category}
                    </span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] text-muted">
                      {STATUS_LABELS[report.status] ?? report.status}
                    </span>
                  </div>
                  <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
                    {report.title}
                  </h2>
                </div>
              </div>

              {report.body ? (
                <p className="mb-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
                  {report.body}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <ThumbsUp size={10} className="text-ok" /> {report.confirmations}
                </span>
                <span className="flex items-center gap-1">
                  <ThumbsDown size={10} className="text-danger" /> {report.rejections}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare size={10} /> {report.commentCount}
                </span>
                {report.buildingName ? (
                  <span className="flex items-center gap-1">
                    <MapPin size={10} /> {report.buildingName}
                  </span>
                ) : (
                  <span className="font-mono">
                    {report.location.lat.toFixed(5)}, {report.location.lng.toFixed(5)}
                  </span>
                )}
                <span className="ml-auto">
                  {new Date(report.createdAt).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
