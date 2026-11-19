"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, LogIn, Mail, Lock, IdCard } from "lucide-react";
import { AuthShell, AuthLink, DemoNotice } from "@/components/auth/AuthShell";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const schema = z.object({
  identifier: z.string().min(3, "Identifiant ou email trop court"),
  password: z.string().min(4, "4 caractères minimum (démo)"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const login = useAppStore((s) => s.login);
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"identifier" | "email">("identifier");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "" },
  });

  const onSubmit = (values: FormValues) => {
    setLoading(true);
    // Simulated latency so the interaction feels real.
    window.setTimeout(() => {
      login(values.identifier);
      router.push("/map");
    }, 620);
  };

  return (
    <AuthShell
      badge="Bienvenue"
      title="Connexion au campus"
      subtitle="Accédez à votre jumeau numérique du campus d'Abomey-Calavi."
      footer={
        <>
          Pas encore de compte ? <AuthLink href="/register">Créer un compte</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-0.5">
          {(
            [
              { k: "identifier", label: "Identifiant étudiant", icon: IdCard },
              { k: "email", label: "Email universitaire", icon: Mail },
            ] as const
          ).map((m) => (
            <button
              key={m.k}
              type="button"
              onClick={() => setMode(m.k)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-medium transition-colors",
                mode === m.k ? "bg-white/[0.09] text-ink" : "text-muted hover:text-ink",
              )}
            >
              <m.icon size={12} />
              {m.label}
            </button>
          ))}
        </div>

        <Field label={mode === "identifier" ? "Identifiant étudiant" : "Email universitaire"} error={errors.identifier?.message} required>
          <div className="relative">
            {mode === "identifier" ? (
              <IdCard size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            ) : (
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            )}
            <input
              {...register("identifier")}
              className={cn(inputClass, "pl-9")}
              placeholder={mode === "identifier" ? "UAC2024177" : "prenom.nom@uac.bj"}
              autoComplete="username"
            />
          </div>
        </Field>

        <Field label="Mot de passe" error={errors.password?.message} required>
          <div className="relative">
            <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              {...register("password")}
              type={showPw ? "text" : "password"}
              className={cn(inputClass, "pl-9 pr-10")}
              placeholder="••••••••"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
              aria-label={showPw ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between pt-0.5">
          <label className="flex cursor-pointer select-none items-center gap-2 text-[11.5px] text-dim">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-cyan"
            />
            Se souvenir de moi
          </label>
          <AuthLink href="/forgot-password">Mot de passe oublié ?</AuthLink>
        </div>

        <Button type="submit" variant="primary" size="lg" full disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Connexion…
            </>
          ) : (
            <>
              <LogIn size={15} /> Se connecter
            </>
          )}
        </Button>

        <DemoNotice />
      </form>
    </AuthShell>
  );
}
