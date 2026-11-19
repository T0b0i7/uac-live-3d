"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Eye,
  Ghost,
  CircleDashed,
  Users,
  ShieldCheck,
  Sparkles,
  BellRing,
  MapPinned,
  GraduationCap,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Button, Badge } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/primitives";
import { PRIVACY_META } from "@/data/students";
import type { PrivacyMode } from "@/types";
import { cn } from "@/lib/utils";

const PRIVACY_ICONS = { open: Eye, friends: Users, zone: CircleDashed, ghost: Ghost };
const PRIVACY_ORDER: PrivacyMode[] = ["ghost", "zone", "friends", "open"];

const AVATAR_SEEDS = [
  "eucher", "abatti", "uac", "ifri", "calavi", "benin", "atlas", "nova", "orbit", "prism", "vortex", "zenith",
];

const FEATURES = [
  { icon: Compass, title: "Carte 3D du campus", text: "Naviguez dans un IFRI modélisé en volume, avec repères et itinéraires piétons." },
  { icon: Users, title: "Radar étudiant", text: "Voyez qui est présent autour de vous, selon votre niveau de confidentialité." },
  { icon: BellRing, title: "Alertes communautaires", text: "Coupures, files d'attente, changement de salle : la communauté vous informe." },
  { icon: GraduationCap, title: "Groupes d'étude", text: "Rejoignez une session de révision ou créez la vôtre en quelques secondes." },
  { icon: MapPinned, title: "Navigation piétonne", text: "Itinéraires simulés avec durée, distance et instructions étape par étape." },
  { icon: ShieldCheck, title: "Confidentialité d'abord", text: "Mode Fantôme par défaut. Votre position ne quitte jamais votre appareil." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const complete = useAppStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [seed, setSeed] = useState(AVATAR_SEEDS[0]!);
  const [privacy, setPrivacy] = useState<PrivacyMode>("ghost");

  const name = user?.fullName ?? "Étudiant UAC";
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const steps = ["Avatar", "Confidentialité", "Découverte"];
  const total = steps.length;

  const finish = () => {
    complete({
      avatarSeed: seed,
      privacy,
      faculty: user?.faculty ?? "IFRI — Informatique",
      department: user?.department ?? "Génie Logiciel",
    });
    router.push("/map");
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-void">
      <div className="absolute inset-0 map-backdrop" />
      <div className="absolute inset-0 map-grid-lines opacity-40" />
      <div className="pointer-events-none absolute -left-32 top-10 h-[420px] w-[420px] rounded-full bg-cyan/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-[400px] w-[400px] rounded-full bg-violet/12 blur-[120px]" />

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-8">
        {/* progress */}
        <div className="mb-8 flex items-center gap-3">
          {steps.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10.5px] font-bold transition-colors",
                  i < step
                    ? "border-success/50 bg-success/20 text-success"
                    : i === step
                      ? "border-cyan bg-cyan text-[#04141b]"
                      : "border-white/15 bg-white/[0.04] text-muted",
                )}
              >
                {i < step ? <Check size={11} /> : i + 1}
              </span>
              <span className={cn("text-[11.5px] font-medium", i === step ? "text-ink" : "text-muted")}>{s}</span>
              {i < total - 1 && <span className={cn("h-px flex-1", i < step ? "bg-success/40" : "bg-white/10")} />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ---------------- step 0: avatar ---------------- */}
          {step === 0 && (
            <motion.div
              key="s0"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28 }}
              className="flex flex-1 flex-col"
            >
              <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Choisissez votre avatar</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Votre identité visuelle sur le radar social du campus. Vous pourrez la modifier plus tard.
              </p>

              <div className="mt-7 flex flex-col items-center gap-4 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-7 backdrop-blur-md">
                <div className="relative">
                  <span className="absolute inset-0 animate-pulse-ring rounded-full border border-cyan/30" />
                  <Avatar initials={initials} seed={seed} size={92} ring status="online" />
                </div>
                <div className="text-center">
                  <p className="font-display text-[16px] font-semibold text-ink">{name}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {user?.department ?? "Génie Logiciel"} · {user?.level ?? "L3"}
                  </p>
                </div>
                <div className="flex max-w-md flex-wrap justify-center gap-2">
                  {AVATAR_SEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeed(s)}
                      className={cn(
                        "rounded-full p-0.5 transition-all",
                        seed === s ? "ring-2 ring-cyan ring-offset-2 ring-offset-[#070b14]" : "opacity-65 hover:opacity-100",
                      )}
                      aria-label={`Avatar ${s}`}
                    >
                      <Avatar initials={initials} seed={s} size={34} />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ---------------- step 1: privacy ---------------- */}
          {step === 1 && (
            <motion.div
              key="s1"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28 }}
              className="flex flex-1 flex-col"
            >
              <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Votre confidentialité</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Choisissez qui peut voir votre position sur le radar. Le mode le plus protecteur est sélectionné par
                défaut.
              </p>

              <div className="mt-6 space-y-2">
                {PRIVACY_ORDER.map((p) => {
                  const meta = PRIVACY_META[p];
                  const Icon = PRIVACY_ICONS[p];
                  const active = privacy === p;
                  return (
                    <button
                      key={p}
                      onClick={() => setPrivacy(p)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-200",
                        active
                          ? "border-cyan/45 bg-cyan/[0.08] shadow-[0_0_0_1px_rgba(53,214,245,0.15)]"
                          : "border-white/[0.08] bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]",
                      )}
                    >
                      <span
                        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
                        style={{
                          borderColor: active ? `${meta.color}55` : "rgba(148,163,184,0.16)",
                          background: active ? `${meta.color}18` : "rgba(255,255,255,0.03)",
                          color: active ? meta.color : "#94a3b8",
                        }}
                      >
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-ink">{meta.label}</span>
                          {p === "ghost" && <Badge tone="cyan">Recommandé</Badge>}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-dim">{meta.description}</span>
                        <span className="mt-1 block text-[10px] uppercase tracking-wider text-muted">{meta.detail}</span>
                      </span>
                      <span
                        className={cn(
                          "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors",
                          active ? "border-cyan bg-cyan text-[#04141b]" : "border-white/20",
                        )}
                      >
                        {active && <Check size={11} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ---------------- step 2: discovery ---------------- */}
          {step === 2 && (
            <motion.div
              key="s2"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28 }}
              className="flex flex-1 flex-col"
            >
              <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Bienvenue sur le campus</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Voici ce que vous pouvez faire dès maintenant avec UAC-LIVE 3D.
              </p>

              <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.title}
                      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 backdrop-blur-md"
                    >
                      <Icon size={16} className="text-cyan" />
                      <p className="mt-2 text-[12.5px] font-semibold text-ink">{f.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{f.text}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-cyan/20 bg-cyan/[0.06] px-3 py-2.5">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-cyan" />
                <p className="text-[11px] leading-relaxed text-dim">
                  Mode <span className="font-semibold text-ink">{PRIVACY_META[privacy].label}</span> sélectionné. Vous
                  pourrez le changer à tout moment depuis la carte.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* actions */}
        <div className="mt-7 flex items-center gap-2.5">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ArrowLeft size={14} /> Retour
          </Button>
          <div className="flex-1" />
          {step < total - 1 ? (
            <Button variant="primary" size="lg" onClick={() => setStep((s) => s + 1)}>
              Continuer <ArrowRight size={15} />
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={finish}>
              <Compass size={15} /> Entrer sur le campus
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
