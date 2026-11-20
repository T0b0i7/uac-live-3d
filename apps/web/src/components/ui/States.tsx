"use client";

/**
 * Composants d'état partagés — apps/web/src/components/ui/States.tsx
 *
 * Chaque état est distinct et explicite :
 *  - chargement → squelette (pas de spinner plein écran qui fait clignoter) ;
 *  - erreur     → message issu du serveur + action « réessayer » ;
 *  - vide       → « aucun résultat », jamais une donnée de démonstration.
 *
 * Ce fichier existe pour empêcher la tentation de remplacer une liste vide par
 * un jeu de données fictif : l'état vide est un composant de première classe.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw, WifiOff } from "lucide-react";
import { ApiError } from "@/lib/api/client";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl2 ${className}`} aria-hidden="true" />;
}

export function LoadingCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl2 border border-line bg-surface/60 p-4">
          <SkeletonBlock className="mb-3 h-4 w-2/3" />
          <SkeletonBlock className="mb-2 h-3 w-1/2" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Affiche une erreur d'API telle qu'elle a été reçue.
 *
 * Le `requestId` est volontairement visible : c'est la seule information qui
 * permet de retrouver la requête exacte dans les journaux du serveur.
 */
export function ErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const isNetwork = apiError?.code === "NETWORK_ERROR" || apiError?.code === "TIMEOUT";

  return (
    <div
      className={`rounded-xl2 border border-danger/35 bg-danger/8 ${compact ? "p-3" : "p-5"}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-danger">
          {isNetwork ? <WifiOff size={18} /> : <AlertTriangle size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {isNetwork ? "Serveur injoignable" : "Le chargement a échoué"}
          </p>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted">
            {apiError?.message ?? "Erreur inconnue."}
          </p>
          {apiError?.requestId ? (
            <p className="mt-2 font-mono text-[10px] text-muted/70">
              requête {apiError.requestId}
            </p>
          ) : null}
          {onRetry && apiError?.isRetryable !== false ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-primary/60 hover:text-primary"
            >
              <RefreshCw size={12} /> Réessayer
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl2 border border-dashed border-line bg-surface/40 px-6 py-12 text-center">
      <div className="mb-3 text-muted/70">{icon ?? <Inbox size={28} />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
