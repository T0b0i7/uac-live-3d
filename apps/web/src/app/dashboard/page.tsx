"use client";

/**
 * Tableau de bord — apps/web/src/app/dashboard/page.tsx
 *
 * Vue d'ensemble alimentée exclusivement par l'API. Chaque indicateur possède
 * un état « indisponible » distinct de « zéro » : afficher 0 alors que le
 * serveur est muet serait un mensonge silencieux.
 */

import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Compass,
  GraduationCap,
  Layers,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorState, SkeletonBlock } from "@/components/ui/States";
import {
  useBuildingStats,
  useFaculties,
  useGraphMetadata,
  useReports,
} from "@/lib/hooks";

export default function DashboardPage() {
  // Compteurs globaux calculés en base : ils portent sur les 360 bâtiments et
  // non sur une page. Auparavant, `georeferenced` et `verified` étaient déduits
  // de `useBuildings({ limit: 100 })`, donc calculés sur 100 bâtiments.
  const stats = useBuildingStats();
  const faculties = useFaculties();
  const graph = useGraphMetadata();
  const reports = useReports({ limit: 5 });

  const totalBuildings = stats.data?.total ?? null;
  const georeferenced = stats.data?.georeferenced ?? null;
  const verified = stats.data?.verification.verified ?? null;
  const withoutGeometry =
    stats.data !== undefined ? stats.data.total - stats.data.georeferenced : null;

  return (
    <AppShell title="Tableau de bord" subtitle="État réel du référentiel du campus">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Bâtiments"
          value={totalBuildings}
          loading={stats.isLoading}
          error={stats.isError}
          hint="Référentiel institutionnel"
          icon={<Building2 size={15} />}
          href="/buildings"
        />
        <Kpi
          label="Géoréférencés"
          value={georeferenced}
          loading={stats.isLoading}
          error={stats.isError}
          hint={
            georeferenced !== null && totalBuildings
              ? `${Math.round((georeferenced / Math.max(totalBuildings, 1)) * 100)} % du bâti`
              : "Polygones PostGIS"
          }
          icon={<Layers size={15} />}
          href="/map"
        />
        <Kpi
          label="Facultés"
          value={faculties.data?.length ?? null}
          loading={faculties.isLoading}
          error={faculties.isError}
          hint="Rattachement des bâtiments"
          icon={<GraduationCap size={15} />}
        />
        <Kpi
          label="Allées piétonnes"
          value={graph.data?.edgeCount ?? null}
          loading={graph.isLoading}
          error={graph.isError}
          hint={
            graph.data
              ? `${graph.data.nodeCount} nœuds · ${graph.data.accessibleEdgeCount} PMR`
              : "Réseau de navigation"
          }
          icon={<Compass size={15} />}
          href="/navigation"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Signalements récents */}
        <section className="rounded-xl2 border border-line bg-surface/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              Signalements récents
            </p>
            <Link
              href="/reports"
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Tout voir <ArrowUpRight size={11} />
            </Link>
          </div>

          {reports.isLoading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-14 w-full" />
              <SkeletonBlock className="h-14 w-full" />
              <SkeletonBlock className="h-14 w-full" />
            </div>
          ) : reports.isError ? (
            <ErrorState error={reports.error} onRetry={() => void reports.refetch()} compact />
          ) : !reports.data || reports.data.items.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">Aucun signalement enregistré.</p>
          ) : (
            <ul className="space-y-1.5">
              {reports.data.items.map((report) => (
                <li
                  key={report.id}
                  className="rounded-lg border border-line/70 bg-secondary/50 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-1 min-w-0 text-xs font-medium text-ink">
                      {report.title}
                    </p>
                    <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[9px] text-muted">
                      {report.confirmations} ✓
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {report.buildingName ?? "Position libre"} ·{" "}
                    {new Date(report.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Intégrité du référentiel */}
        <section className="rounded-xl2 border border-line bg-surface/60 p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted">
            Intégrité du référentiel
          </p>

          {stats.isLoading || graph.isLoading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
            </div>
          ) : (
            <ul className="space-y-2">
              <IntegrityRow
                icon={<ShieldCheck size={13} />}
                label="Bâtiments vérifiés"
                value={
                  verified !== null && totalBuildings !== null
                    ? `${verified} / ${totalBuildings}`
                    : null
                }
                tone={
                  verified !== null && totalBuildings !== null && verified === totalBuildings
                    ? "ok"
                    : "warn"
                }
              />
              <IntegrityRow
                icon={<Layers size={13} />}
                label="Sans emprise géographique"
                value={withoutGeometry !== null ? String(withoutGeometry) : null}
                tone={withoutGeometry !== null && withoutGeometry > 0 ? "warn" : "ok"}
              />
              <IntegrityRow
                icon={<TriangleAlert size={13} />}
                label="Graphe validé terrain"
                value={graph.data ? (graph.data.isValidated ? "oui" : "non") : null}
                tone={graph.data?.isValidated ? "ok" : "warn"}
              />
              <IntegrityRow
                icon={<Compass size={13} />}
                label="Version du graphe"
                value={graph.data?.version ?? null}
                tone="neutral"
                mono
              />
            </ul>
          )}

          {graph.data?.disclaimer ? (
            <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-muted/70">
              {graph.data.disclaimer}
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  loading,
  error,
  href,
}: {
  label: string;
  value: number | null;
  hint: string;
  icon: React.ReactNode;
  loading: boolean;
  error: boolean;
  href?: string;
}) {
  const body = (
    <div className="rounded-xl2 border border-line bg-surface/60 p-4 transition hover:border-primary/40">
      <div className="mb-2 flex items-center justify-between text-muted">
        <span className="flex items-center gap-1.5">
          {icon}
          <span className="text-[10px] uppercase tracking-wider">{label}</span>
        </span>
        {href ? <ArrowUpRight size={12} /> : null}
      </div>
      {loading ? (
        <div className="skeleton h-8 w-14 rounded-lg" />
      ) : error || value === null ? (
        <p className="text-2xl font-semibold text-muted/40">—</p>
      ) : (
        <p className="text-2xl font-semibold text-ink">{value}</p>
      )}
      <p className={`mt-1 text-[10px] ${error ? "text-danger" : "text-muted/80"}`}>
        {error ? "API injoignable" : hint}
      </p>
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

function IntegrityRow({
  icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  tone: "ok" | "warn" | "neutral";
  mono?: boolean;
}) {
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-secondary/40 px-2.5 py-2">
      <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={`shrink-0 text-[11px] font-medium ${toneClass} ${mono ? "font-mono" : ""}`}
      >
        {value ?? "—"}
      </span>
    </li>
  );
}
