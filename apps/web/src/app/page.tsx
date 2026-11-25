"use client";

/**
 * Landing page — apps/web/src/app/page.tsx
 *
 * Point d'entrée public. Les chiffres affichés sont LUS depuis l'API
 * (`/faculties`, `/buildings`, `/navigation/graph`) : si le serveur est arrêté,
 * la page affiche un état d'erreur explicite plutôt que des chiffres
 * décoratifs qui ne correspondraient à rien.
 */

import Link from "next/link";
import { ArrowRight, Compass, Layers, MapPin, Radio, WifiOff } from "lucide-react";
import { useBuildingStats, useFaculties, useGraphMetadata } from "@/lib/hooks";

export default function LandingPage() {
  const faculties = useFaculties();
  // Compteurs globaux (calculés en base). Auparavant la page déduisait
  // « X avec emprise géographique » de `useBuildings({ limit: 100 })` : le
  // nombre portait donc sur 100 bâtiments alors que le total affiché à côté
  // valait 360. Les deux chiffres ne parlaient pas de la même population.
  const stats = useBuildingStats();
  const graph = useGraphMetadata();

  const totalBuildings = stats.data?.total ?? null;
  const georeferenced = stats.data?.georeferenced ?? null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      {/* Halo décoratif : purement visuel, aucune information. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/12 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-52 right-0 h-[420px] w-[560px] rounded-full bg-violet/12 blur-[130px]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-7 md:px-8">
        {/* En-tête */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Radio size={18} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">UAC-Live 3D</span>
          </div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-line bg-surface/70 px-3.5 py-2 text-xs font-medium text-ink transition hover:border-primary/60 hover:text-primary"
          >
            Ouvrir l'application
          </Link>
        </header>

        {/* Héros */}
        <section className="flex flex-1 flex-col justify-center py-12 md:py-16">
          <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary">
            <MapPin size={12} /> Campus d'Abomey-Calavi · Bénin
          </span>

          <h1 className="max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-4xl md:text-5xl">
            Le campus en{" "}
            <span className="bg-gradient-to-r from-primary to-violet bg-clip-text text-transparent">
              trois dimensions
            </span>
            , accessible à tous.
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted md:text-base">
            Carte 3D des bâtiments, navigation piétonne calculée sur le réseau d'allées réel,
            signalements géolocalisés en temps réel. Conçu pour fonctionner même quand le réseau
            du campus faiblit.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/map"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[#04121a] transition hover:brightness-110"
            >
              Explorer la carte <ArrowRight size={15} />
            </Link>
            <Link
              href="/navigation"
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-primary/60 hover:text-primary"
            >
              <Compass size={15} /> Calculer un itinéraire
            </Link>
          </div>

          {/* Chiffres réels */}
          <div className="mt-11 grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Bâtiments référencés"
              value={stats.isError ? null : totalBuildings}
              hint={
                stats.isError
                  ? "API injoignable"
                  : georeferenced !== null
                    ? `${georeferenced} avec emprise géographique`
                    : "Polygones PostGIS"
              }
              icon={<Layers size={15} />}
              loading={stats.isLoading}
            />
            <StatCard
              label="Facultés"
              value={faculties.isError ? null : (faculties.data?.length ?? null)}
              hint={faculties.isError ? "API injoignable" : "Rattachement institutionnel"}
              icon={<Radio size={15} />}
              loading={faculties.isLoading}
            />
            <StatCard
              label="Réseau piéton"
              value={graph.isError ? null : (graph.data?.edgeCount ?? null)}
              hint={
                graph.isError
                  ? "API injoignable"
                  : `${graph.data?.nodeCount ?? 0} nœuds · ${graph.data?.accessibleEdgeCount ?? 0} allées accessibles`
              }
              icon={<Compass size={15} />}
              loading={graph.isLoading}
            />
          </div>

          {stats.isError && faculties.isError ? (
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/8 px-3.5 py-2.5 text-xs text-warn">
              <WifiOff size={14} />
              L'API n'est pas joignable. Les chiffres ci-dessus restent vides : aucune valeur
              n'est inventée.
            </div>
          ) : null}
        </section>

        <footer className="border-t border-line pt-5 text-[11px] text-muted/70">
          UAC-Live 3D — données institutionnelles vérifiées, source affichée pour chaque bâtiment.
        </footer>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string;
  value: number | null;
  hint: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl2 border border-line bg-surface/60 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-muted">
        {icon}
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      {loading ? (
        <div className="skeleton h-8 w-16 rounded-lg" />
      ) : value === null ? (
        <p className="text-2xl font-semibold text-muted/50">—</p>
      ) : (
        <p className="text-2xl font-semibold text-ink">{value}</p>
      )}
      <p className="mt-1 text-[11px] text-muted/80">{hint}</p>
    </div>
  );
}
