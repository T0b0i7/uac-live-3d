"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, UserPlus, Check, ChevronDown, Mail, User, Hash } from "lucide-react";
import { AuthShell, AuthLink, DemoNotice } from "@/components/auth/AuthShell";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const FACTULTIES = [
  "IFRI — Informatique",
  "FAST — Sciences et Techniques",
  "FLSH — Lettres et Sciences Humaines",
  "FADESP — Droit et Science Politique",
  "FSA — Sciences Agronomiques",
  "FASEG — Sciences Économiques",
  "INJEPS — Sport et Éducation",
];

const DEPARTMENTS: Record<string, string[]> = {
  "IFRI — Informatique": ["Génie Logiciel", "Réseaux & Télécoms", "Intelligence Artificielle", "Sécurité Informatique"],
  "FAST — Sciences et Techniques": ["Mathématiques", "Physique", "Chimie Analytique", "Biologie Cellulaire", "Géologie"],
  "FLSH — Lettres et Sciences Humaines": ["Lettres Modernes", "Philosophie", "Histoire", "Géographie", "Langues Vivantes"],
  "FADESP — Droit et Science Politique": ["Droit Public", "Droit Privé", "Science Politique", "Relations Internationales"],
  "FSA — Sciences Agronomiques": ["Sciences Agronomiques", "Production Végétale", "Économie Rurale"],
  "FASEG — Sciences Économiques": ["Sciences Économiques", "Gestion", "Comptabilité"],
  "INJEPS — Sport et Éducation": ["STAPS", "Éducation Physique"],
};

const LEVELS = ["L1", "L2", "L3", "L4", "M1", "M2", "Doctorat"];

const schema = z
  .object({
    fullName: z.string().min(3, "Nom complet requis"),
    matricule: z.string().min(5, "Numéro de matricule requis"),
    email: z.string().email("Email valide requis"),
    faculty: z.string().min(1, "Choisissez une faculté"),
    department: z.string().min(1, "Choisissez un département"),
    level: z.string().min(1, "Choisissez un niveau"),
    password: z.string().min(6, "6 caractères minimum"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: "Les mots de passe ne correspondent pas", path: ["confirm"] });

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const registerUser = useAppStore((s) => s.register);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "",
      matricule: "",
      email: "",
      faculty: FACTULTIES[0],
      department: DEPARTMENTS[FACTULTIES[0]!]![0]!,
      level: "L1",
      password: "",
      confirm: "",
    },
  });

  const faculty = watch("faculty");
  const departments = DEPARTMENTS[faculty] ?? [];

  const onSubmit = (v: FormValues) => {
    setLoading(true);
    window.setTimeout(() => {
      registerUser({
        fullName: v.fullName,
        matricule: v.matricule,
        email: v.email,
        faculty: v.faculty,
        department: v.department,
        level: v.level,
      });
      router.push("/onboarding");
    }, 700);
  };

  return (
    <AuthShell
      badge="Nouveau compte"
      title="Créer votre profil campus"
      subtitle="Quelques informations suffisent pour rejoindre le réseau UAC-LIVE 3D."
      footer={
        <>
          Déjà inscrit ? <AuthLink href="/login">Se connecter</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Field label="Nom complet" error={errors.fullName?.message} required>
          <div className="relative">
            <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input {...register("fullName")} className={cn(inputClass, "pl-9")} placeholder="Eucher ABATTI" />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Matricule" error={errors.matricule?.message} required>
            <div className="relative">
              <Hash size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input {...register("matricule")} className={cn(inputClass, "pl-9")} placeholder="UAC2024177" />
            </div>
          </Field>
          <Field label="Niveau" error={errors.level?.message} required>
            <select {...register("level")} className={inputClass}>
              {LEVELS.map((l) => (
                <option key={l} value={l} className="bg-[#0d1422]">
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Email universitaire" error={errors.email?.message} required>
          <div className="relative">
            <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input {...register("email")} className={cn(inputClass, "pl-9")} placeholder="prenom.nom@uac.bj" />
          </div>
        </Field>

        <Field label="Faculté" error={errors.faculty?.message} required>
          <select {...register("faculty")} className={inputClass}>
            {FACTULTIES.map((f) => (
              <option key={f} value={f} className="bg-[#0d1422]">
                {f}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Département" error={errors.department?.message} required>
          <select {...register("department")} className={inputClass}>
            {departments.map((d) => (
              <option key={d} value={d} className="bg-[#0d1422]">
                {d}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Mot de passe" error={errors.password?.message} required>
            <div className="relative">
              <input
                {...register("password")}
                type={showPw ? "text" : "password"}
                className={cn(inputClass, "pr-9")}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-white/[0.07] hover:text-ink"
                aria-label="Afficher le mot de passe"
              >
                {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>
          <Field label="Confirmation" error={errors.confirm?.message} required>
            <input {...register("confirm")} type={showPw ? "text" : "password"} className={inputClass} placeholder="••••••••" />
          </Field>
        </div>

        <Button type="submit" variant="primary" size="lg" full disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Création…
            </>
          ) : (
            <>
              <UserPlus size={15} /> Créer mon compte
            </>
          )}
        </Button>

        <DemoNotice />
      </form>
    </AuthShell>
  );
}
