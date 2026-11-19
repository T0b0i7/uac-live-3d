"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Bell,
  Compass,
  GraduationCap,
  Map as MapIcon,
  Settings,
  ShieldAlert,
  Users,
  UserRound,
  LogOut,
  Radio,
  Sparkles,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, useUnreadCount } from "@/store/useAppStore";
import { Avatar } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof MapIcon;
  badgeKey?: "notifications" | "alerts" | "requests";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/map", label: "Explorer", icon: Compass },
  { href: "/friends", label: "Amis", icon: Users, badgeKey: "requests" },
  { href: "/study", label: "Study Spots", icon: GraduationCap },
  { href: "/alerts", label: "Alertes", icon: ShieldAlert, badgeKey: "alerts" },
  { href: "/notifications", label: "Notifications", icon: Bell, badgeKey: "notifications" },
  { href: "/profile", label: "Mon profil", icon: UserRound },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/map" className="group flex items-center gap-2.5">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-cyan/25 bg-gradient-to-br from-cyan/25 via-[#0c2233] to-violet/25">
        <Compass size={19} className="text-cyan transition-transform duration-500 group-hover:rotate-45" />
        <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-[15px] font-extrabold tracking-tight text-ink">
            UAC-LIVE <span className="text-cyan">3D</span>
          </span>
          <span className="mt-1 block text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted">
            Campus Map & Social Radar
          </span>
        </span>
      )}
    </Link>
  );
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-[0_0_12px_rgba(244,63,94,0.55)]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const privacy = useAppStore((s) => s.privacy);
  const unread = useUnreadCount();
  const alerts = useAppStore(useShallow((s) => s.alerts.filter((a) => a.status === "active").length));
  const requests = useAppStore((s) => s.friendRequests.length);
  const groups = useAppStore((s) => s.groups.length);

  const counts = { notifications: unread, alerts, requests };

  return (
    <aside className="flex h-full w-full flex-col gap-4">
      <div className="flex items-center justify-between px-1 pt-1">
        <Logo />
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const count = item.badgeKey ? counts[item.badgeKey] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-cyan/16 to-transparent text-ink"
                  : "text-muted hover:bg-white/[0.05] hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-cyan shadow-[0_0_12px_rgba(53,214,245,0.9)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                size={17}
                className={cn("shrink-0 transition-colors", active ? "text-cyan" : "text-muted group-hover:text-cyan/80")}
              />
              <span className="truncate">{item.label}</span>
              <Badge count={item.href === "/study" ? 0 : count} />
            </Link>
          );
        })}
      </nav>

      <div className="mx-1 rounded-xl border border-cyan/15 bg-gradient-to-br from-cyan/[0.08] to-violet/[0.06] p-3">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-cyan">
          <Radio size={11} className="animate-pulse" /> En direct
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
          <span className="font-semibold text-ink">{groups}</span> groupes d&apos;étude ·{" "}
          <span className="font-semibold text-ink">{alerts}</span> alertes actives
        </p>
      </div>

      <div className="mt-auto space-y-2">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
            pathname === "/settings" ? "bg-white/[0.06] text-ink" : "text-muted hover:bg-white/[0.05] hover:text-ink",
          )}
        >
          <Settings size={17} className="shrink-0" />
          Paramètres
        </Link>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
          <Link href="/profile" onClick={onNavigate} className="flex items-center gap-2.5">
            <Avatar
              initials={user?.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("") ?? "EA"}
              seed={user?.avatarSeed ?? "eucher"}
              size={38}
              status="online"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-ink">{user?.fullName ?? "Invité"}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
                {privacy === "ghost" ? "Fantôme" : privacy === "open" ? "Ouvert" : privacy === "friends" ? "Amis" : "Zone"}
                <span className="opacity-50">·</span>
                {user?.level ?? "L3"}
              </span>
            </span>
            <Sparkles size={13} className="shrink-0 text-violet" />
          </Link>
          <button
            onClick={() => {
              logout();
              onNavigate?.();
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] py-1.5 text-[11.5px] font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
          >
            <LogOut size={12} /> Déconnexion
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const items = [
    { href: "/map", label: "Carte", icon: MapIcon },
    { href: "/alerts", label: "Alertes", icon: ShieldAlert },
    { href: "/study", label: "Étude", icon: GraduationCap },
    { href: "/friends", label: "Amis", icon: Users },
    { href: "/profile", label: "Profil", icon: UserRound },
  ];
  const unread = useUnreadCount();
  const alerts = useAppStore(useShallow((s) => s.alerts.filter((a) => a.status === "active").length));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.08] bg-[#070b14]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="flex items-stretch justify-around px-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const badge = item.href === "/alerts" ? alerts : item.href === "/profile" ? unread : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                active ? "text-cyan" : "text-muted",
              )}
            >
              {active && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-cyan shadow-[0_0_10px_rgba(53,214,245,0.9)]" />}
              <span className="relative">
                <Icon size={19} />
                {badge > 0 && (
                  <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
