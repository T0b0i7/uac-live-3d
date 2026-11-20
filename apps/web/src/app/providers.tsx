"use client";

/**
 * Providers applicatifs — apps/web/src/app/providers.tsx
 *
 * TanStack Query est configuré pour un usage terrain : le réseau du campus est
 * intermittent, donc on évite les retentes agressives et on privilégie la
 * conservation des données déjà obtenues.
 *
 * `retry` est une fonction, pas un booléen : on ne retente JAMAIS une erreur
 * 4xx (une requête mal formée ou non autorisée échouera toujours de la même
 * façon), on retente seulement le réseau et les 5xx.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Les bâtiments ne changent pas toutes les 30 secondes ; ce cache évite
        // de recharger 15 polygones à chaque navigation entre les pages.
        staleTime: 60_000,
        gcTime: 15 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // `useState` garantit un seul QueryClient par arbre React, y compris avec
  // React StrictMode qui monte les composants deux fois en développement.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
