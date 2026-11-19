"use client";

import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const TONES = {
  info: { icon: Info, color: "text-cyan", bar: "bg-cyan" },
  success: { icon: CheckCircle2, color: "text-success", bar: "bg-success" },
  warning: { icon: AlertTriangle, color: "text-warning", bar: "bg-warning" },
  danger: { icon: XCircle, color: "text-danger", bar: "bg-danger" },
};

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-4 z-[120] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const tone = TONES[toast.tone];
          const Icon = tone.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="panel pointer-events-auto relative overflow-hidden rounded-xl border-white/[0.1] p-3.5 pr-9"
            >
              <span className={cn("absolute left-0 top-0 h-full w-[3px]", tone.bar)} />
              <div className="flex gap-2.5">
                <Icon size={17} className={cn("mt-0.5 shrink-0", tone.color)} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-dim">{toast.description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
                aria-label="Fermer la notification"
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
