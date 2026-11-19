"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  GraduationCap,
  Navigation2,
  ShieldAlert,
  Trash2,
  UserPlus,
  Sparkles,
} from "lucide-react";
import { useAppStore, useUnreadCount } from "@/store/useAppStore";
import { relativeTime } from "@/data/alerts";
import { Badge, Button, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { NotificationType } from "@/types";

const TYPE_META: Record<
  NotificationType,
  { label: string; icon: typeof Bell; color: string; bg: string }
> = {
  "friend-request": { label: "Amis", icon: UserPlus, color: "#35D6F5", bg: "rgba(53,214,245,0.12)" },
  "group-invite": { label: "Groupes", icon: GraduationCap, color: "#8B5CF6", bg: "rgba(139,92,246,0.14)" },
  "campus-alert": { label: "Alertes", icon: ShieldAlert, color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  navigation: { label: "Navigation", icon: Navigation2, color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
  confirmation: { label: "Communauté", icon: Sparkles, color: "#A78BFA", bg: "rgba(167,139,250,0.14)" },
};

export default function NotificationsPage() {
  const notifications = useAppStore((s) => s.notifications);
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAll = useAppStore((s) => s.markAllNotificationsRead);
  const clearAll = useAppStore((s) => s.clearNotifications);
  const unread = useUnreadCount();
  const [filter, setFilter] = useState<NotificationType | "all">("all");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const filtered = useMemo(() => {
    let list = [...notifications];
    if (filter !== "all") list = list.filter((n) => n.type === filter);
    if (onlyUnread) list = list.filter((n) => !n.read);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [notifications, filter, onlyUnread]);

  const types = Object.keys(TYPE_META) as NotificationType[];

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/[0.07] bg-gradient-to-b from-[#0b1320] to-transparent px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan/30 bg-cyan/12 text-cyan">
                <BellRing size={17} />
              </span>
              <div>
                <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Notifications</h1>
                <p className="text-[11.5px] text-dim">
                  {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
                </p>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={markAll} disabled={unread === 0}>
                <CheckCheck size={13} /> Tout marquer lu
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAll} disabled={notifications.length === 0}>
                <Trash2 size={13} />
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === "all"
                  ? "border-cyan/40 bg-cyan/12 text-cyan"
                  : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
              )}
            >
              Toutes
            </button>
            {types.map((t) => {
              const m = TYPE_META[t];
              const n = notifications.filter((x) => x.type === t).length;
              if (n === 0) return null;
              return (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    filter === t ? "text-ink" : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
                  )}
                  style={filter === t ? { borderColor: `${m.color}66`, background: `${m.color}18`, color: m.color } : undefined}
                >
                  {m.label}
                  <span className="rounded-full bg-white/10 px-1 text-[9.5px]">{n}</span>
                </button>
              );
            })}
            <button
              onClick={() => setOnlyUnread((v) => !v)}
              className={cn(
                "ml-auto rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                onlyUnread
                  ? "border-warning/40 bg-warning/12 text-warning"
                  : "border-white/[0.09] bg-white/[0.03] text-muted hover:text-ink",
              )}
            >
              Non lues
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Bell size={20} />}
            title="Aucune notification"
            description="Vous êtes à jour. Les nouveaux événements du campus apparaîtront ici."
          />
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {filtered.map((n) => {
                const m = TYPE_META[n.type];
                const Icon = m.icon;
                const Wrapper = n.href ? Link : "div";
                return (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.18 }}
                  >
                    <Wrapper
                      href={n.href ?? "/notifications"}
                      onClick={() => markRead(n.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                        n.read
                          ? "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
                          : "border-cyan/20 bg-cyan/[0.05] hover:bg-cyan/[0.08]",
                      )}
                    >
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                        style={{ background: m.bg, color: m.color }}
                      >
                        <Icon size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={cn("truncate text-[12.5px]", n.read ? "font-medium text-dim" : "font-semibold text-ink")}>
                            {n.title}
                          </p>
                          {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />}
                        </div>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{n.body}</p>
                        <p className="mt-1 text-[10px] text-muted">{relativeTime(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-success"
                          aria-label="Marquer comme lu"
                        >
                          <Check size={12} />
                        </button>
                      )}
                    </Wrapper>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-2">
          <Badge tone="neutral">
            <Bell size={9} /> {notifications.length} notifications · données simulées
          </Badge>
        </div>
      </div>
    </div>
  );
}
