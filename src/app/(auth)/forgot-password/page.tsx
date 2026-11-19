"use client";

import { useState } from "react";
import { Mail, ArrowLeft, Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { AuthShell, AuthLink } from "@/components/auth/AuthShell";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <AuthShell
      badge="Récupération"
      title="Mot de passe oublié"
      subtitle="Nous vous enverrons un lien de réinitialisation sur votre email universitaire."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ArrowLeft size={12} /> <AuthLink href="/login">Retour à la connexion</AuthLink>
        </span>
      }
    >
      {sent ? (
        <div className="space-y-3.5">
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-success/25 bg-success/[0.07] px-4 py-6 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-success/15 text-success">
              <CheckCircle2 size={22} />
            </span>
            <p className="text-[13.5px] font-semibold text-ink">Lien simulé envoyé</p>
            <p className="max-w-xs text-[12px] leading-relaxed text-dim">
              Un email de réinitialisation aurait été envoyé à <span className="text-ink">{email}</span>. Aucun email
              réel n&apos;a été transmis dans ce prototype.
            </p>
          </div>
          <Button variant="secondary" full onClick={() => setSent(false)}>
            Utiliser une autre adresse
          </Button>
          <AuthLink href="/login">Retour à la connexion</AuthLink>
        </div>
      ) : (
        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            setLoading(true);
            window.setTimeout(() => {
              setLoading(false);
              setSent(true);
            }, 650);
          }}
        >
          <Field label="Email universitaire" required>
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                className={cn(inputClass, "pl-9")}
                placeholder="prenom.nom@uac.bj"
              />
            </div>
          </Field>
          <Button type="submit" variant="primary" size="lg" full disabled={loading || !email}>
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Envoi…
              </>
            ) : (
              "Envoyer le lien de réinitialisation"
            )}
          </Button>
          <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-cyan" />
            <p className="text-[10.5px] leading-relaxed text-muted">
              Processus entièrement simulé côté client. Aucune donnée n&apos;est envoyée à un serveur.
            </p>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
