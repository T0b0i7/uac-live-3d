"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Compass, MapPin, ShieldCheck, Sparkles, Users, Wifi } from "lucide-react";

const HIGHLIGHTS = [
  { icon: MapPin, title: "Jumeau numérique 3D", text: "Explorez l'IFRI et le campus d'Abomey-Calavi en trois dimensions." },
  { icon: Users, title: "Radar social", text: "Retrouvez vos amis, découvrez qui est dans votre bâtiment." },
  { icon: ShieldCheck, title: "Confidentialité par défaut", text: "Mode Fantôme activé au départ. Vous décidez qui vous voit." },
  { icon: Wifi, title: "Alertes communautaires", text: "Coupures, files d'attente, changements de salle, en temps réel." },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  badge,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-void">
      {/* ambient background */}
      <div className="absolute inset-0 map-backdrop" />
      <div className="absolute inset-0 map-grid-lines opacity-50" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-cyan/10 blur-[130px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[480px] w-[480px] rounded-full bg-violet/12 blur-[130px]" />

      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-6xl grid-cols-1 items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8">
        {/* Left brand narrative */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="hidden lg:block"
        >
          <div className="flex items-center gap-3">
            <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-cyan/30 bg-gradient-to-br from-cyan/25 via-[#0b1e2c] to-violet/25">
              <Compass size={24} className="text-cyan" />
            </span>
            <div>
              <p className="font-display text-[19px] font-extrabold leading-none tracking-tight text-ink">
                UAC-LIVE <span className="text-cyan">3D</span>
              </p>
              <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
                Campus Map & Social Radar
              </p>
            </div>
          </div>

          <h1 className="mt-9 font-display text-[38px] font-extrabold leading-[1.08] tracking-tight text-ink">
            Le campus de{" "}
            <span className="bg-gradient-to-r from-cyan via-[#7ee8ff] to-violet bg-clip-text text-transparent">
              demain
            </span>
            ,<br />
            dans votre poche.
          </h1>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-dim">
            Jumeau numérique social de l&apos;Université d&apos;Abomey-Calavi. Explorez l&apos;IFRI en 3D, découvrez
            qui est autour de vous et ne ratez plus jamais une alerte du campus.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3">
            {HIGHLIGHTS.map((h) => {
              const Icon = h.icon;
              return (
                <div
                  key={h.title}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5 backdrop-blur-md transition-colors hover:border-cyan/25 hover:bg-white/[0.055]"
                >
                  <Icon size={16} className="text-cyan" />
                  <p className="mt-2 text-[12.5px] font-semibold text-ink">{h.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{h.text}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
            <Sparkles size={15} className="shrink-0 text-violet" />
            <p className="text-[11px] leading-relaxed text-muted">
              Prototype frontend · données simulées · aucune donnée réelle d&apos;étudiant n&apos;est utilisée.
              Projet de <span className="text-dim">Eucher ABATTI</span>.
            </p>
          </div>
        </motion.div>

        {/* Right form card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="w-full"
        >
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan/30 bg-cyan/12">
              <Compass size={20} className="text-cyan" />
            </span>
            <div>
              <p className="font-display text-[15px] font-extrabold leading-none text-ink">
                UAC-LIVE <span className="text-cyan">3D</span>
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted">Campus Map & Social Radar</p>
            </div>
          </div>

          <div className="panel rounded-3xl p-6 sm:p-7">
            {badge && (
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan">
                {badge}
              </span>
            )}
            <h2 className="font-display text-[22px] font-bold tracking-tight text-ink">{title}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-dim">{subtitle}</p>
            <div className="mt-5">{children}</div>
          </div>
          {footer && <div className="mt-4 text-center text-[12px] text-dim">{footer}</div>}
        </motion.div>
      </div>
    </div>
  );
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-white/[0.08]" />
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</span>
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}

export function DemoNotice() {
  return (
    <p className="mt-3 rounded-lg border border-warning/20 bg-warning/[0.07] px-2.5 py-2 text-[10.5px] leading-relaxed text-warning">
      Environnement de démonstration : l&apos;authentification est simulée localement. N&apos;utilisez pas de mot de
      passe réel.
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-cyan transition-colors hover:text-[#7ce8ff]">
      {children}
    </Link>
  );
}
