"use client";

/**
 * Coquille applicative — apps/web/src/components/layout/AppShell.tsx
 *
 * Navigation responsive unique pour toutes les pages internes :
 *  - ≥ md : barre latérale fixe ;
 *  - < md : barre inférieure (pouce), la cible tactile la plus accessible.
 *
 * Aucun écran n'est « desktop seulement » : chaque page rendue dans cette
 * coquille est utilisable sur un téléphone.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Building2,
  Compass,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  Radio,
  TriangleAlert,
  X,
} from "lucide-react";
import { useHealth } from "@/lib/hooks";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof MapIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", shortLabel: "Accueil", icon: LayoutDashboard },
  { href: "/map", label: "Carte du campus", shortLabel: "Carte", icon: MapIcon },
  { href: "/buildings", label: "Bâtiments", shortLabel: "Bâtiments", icon: Building2 },
  { href: "/navigation", label: "Navigation", shortLabel: "Itinéraire", icon: Compass },
  { href: "/reports", label: "Signalements", shortLabel: "Signaler", icon: TriangleAlert },
];

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  fullBleed = false,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** La carte occupe toute la hauteur disponible (pas de padding). */
  fullBleed?: boolean;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const health = useHealth();

  const statusColor = health.isError
    ? "bg-danger"
    : health.data
      ? "bg-ok"
      : "bg-warn";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      {/* ---------- Barre latérale (desktop) ---------- */}
      <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-secondary md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Radio size={18} />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-ink">UAC-Live 3D</span>
            <span className="block text-[10px] uppercase tracking-wider text-muted">Campus UAC</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-primary/12 font-medium text-primary"
                    : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
            {health.isError
              ? "API injoignable"
              : health.data
                ? `API ${health.data.status} · PostGIS ${health.data.postgis ?? "?"}`
                : "Vérification…"}
          </div>
          {health.data ? (
            <p className="mt-1.5 font-mono text-[10px] text-muted/60">
              v{health.data.version} · {Math.floor(health.data.uptimeSeconds / 60)} min
            </p>
          ) : null}
        </div>
      </aside>

      {/* ---------- Contenu ---------- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-30 flex shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-3 py-2.5 backdrop-blur-xl sm:px-4 md:px-6 md:py-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="shrink-0 rounded-lg border border-line p-2 text-muted md:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu size={17} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-ink sm:text-base md:text-lg">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-[10px] text-muted sm:text-[11px] md:text-xs">{subtitle}</p>
            ) : null}
          </div>

          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>

        <main
          className={
            fullBleed
              ? "min-h-0 flex-1 overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-6 md:py-6"
          }
        >
          {fullBleed ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-[1500px]">{children}</div>
          )}
        </main>

        {/* ---------- Barre inférieure (mobile) ---------- */}
        <nav
          className="z-30 grid shrink-0 grid-cols-5 border-t border-line bg-secondary/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
          aria-label="Navigation principale"
        >
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 transition ${
                  active ? "text-primary" : "text-muted"
                }`}
              >
                <Icon size={17} className="shrink-0" />
                <span className="w-full truncate text-center text-[9px] leading-tight">
                  {item.shortLabel}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ---------- Tiroir mobile ---------- */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 border-r border-line bg-secondary p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">UAC-Live 3D</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg border border-line p-1.5 text-muted"
                aria-label="Fermer"
              >
                <X size={15} />
              </button>
            </div>
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-surface hover:text-ink"
                  >
                    <Icon size={17} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
