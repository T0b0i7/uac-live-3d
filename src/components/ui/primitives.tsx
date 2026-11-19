"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react";

/* ---------------------------------------------------------------- Button */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-cyan text-[#04141b] hover:bg-[#5ce2ff] shadow-[0_10px_30px_-12px_rgba(53,214,245,0.8)] font-semibold",
  secondary:
    "bg-white/[0.06] text-ink hover:bg-white/[0.11] border border-white/10 backdrop-blur-md",
  ghost: "text-muted hover:text-ink hover:bg-white/[0.06]",
  danger: "bg-danger text-white hover:bg-[#ff5f79] shadow-[0_10px_30px_-12px_rgba(244,63,94,0.8)] font-semibold",
  success: "bg-success text-[#032c15] hover:bg-[#3fdc7c] font-semibold",
  outline: "border border-cyan/40 text-cyan hover:bg-cyan/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-[13.5px] gap-2 rounded-xl",
  lg: "h-12 px-6 text-[14.5px] gap-2.5 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; full?: boolean }
>(function Button({ className, variant = "secondary", size = "md", full, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-all duration-200 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]",
        "disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full",
        className,
      )}
      {...props}
    />
  );
});

/* ---------------------------------------------------------------- Panel */

export function Panel({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "aside";
}) {
  return (
    <As
      className={cn(
        "panel rounded-2xl",
        className,
      )}
    >
      {children}
    </As>
  );
}

/* ---------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = "neutral",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: "neutral" | "cyan" | "violet" | "success" | "warning" | "danger";
  className?: string;
  dot?: boolean;
}) {
  const tones = {
    neutral: "bg-white/[0.07] text-muted-ink border-white/10",
    cyan: "bg-cyan/12 text-cyan border-cyan/25",
    violet: "bg-violet/15 text-[#b79cff] border-violet/30",
    success: "bg-success/12 text-success border-success/25",
    warning: "bg-warning/12 text-warning border-warning/25",
    danger: "bg-danger/12 text-danger border-danger/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight tracking-wide",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Kbd */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-0.5 font-sans text-[10.5px] font-medium text-muted">
      {children}
    </kbd>
  );
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({
  initials,
  seed,
  size = 36,
  ring,
  status,
  className,
}: {
  initials: string;
  seed: string;
  size?: number;
  ring?: boolean;
  status?: "online" | "offline" | "busy";
  className?: string;
}) {
  // Deterministic gradient from the seed.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 48) % 360;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        ring && "ring-2 ring-cyan/50 ring-offset-2 ring-offset-[#0d1422]",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.34),
        background: `linear-gradient(135deg, hsl(${hue} 72% 52%), hsl(${hue2} 68% 38%))`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
      aria-hidden
    >
      {initials}
      {status && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0d1422]",
            status === "online" ? "bg-success" : status === "busy" ? "bg-danger" : "bg-slate-500",
          )}
          style={{ width: size * 0.3, height: size * 0.3 }}
        />
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- Progress */

export function Meter({
  value,
  max,
  tone = "cyan",
  className,
  height = 6,
}: {
  value: number;
  max: number;
  tone?: "cyan" | "violet" | "success" | "warning" | "danger";
  className?: string;
  height?: number;
}) {
  const p = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const colors = {
    cyan: "bg-cyan",
    violet: "bg-violet",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  };
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-white/[0.07]", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", colors[tone])}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Section header */

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-cyan">
            {icon}
          </span>
        )}
        <div>
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-relaxed text-dim">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-cyan">
        {icon}
      </span>
      <div>
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-dim">{description}</p>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

/* ---------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-4 py-2.5",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {(label || description) && (
        <span className="min-w-0 flex-1">
          {label && <span className="block text-[13.5px] font-medium text-ink">{label}</span>}
          {description && <span className="mt-0.5 block text-[12px] leading-relaxed text-dim">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-300",
          checked ? "border-cyan/50 bg-cyan/85" : "border-white/12 bg-white/[0.08]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all duration-300",
            checked ? "left-[22px]" : "left-0.5 bg-slate-300",
          )}
        />
      </button>
    </label>
  );
}

/* ---------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[12.5px] font-medium text-ink/90">
        {label}
        {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] text-dim">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-muted/70 outline-none transition-colors focus:border-cyan/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-cyan/15";

/* ---------------------------------------------------------------- Sheet / Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal>
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-[#04070d]/80 backdrop-blur-sm"
      />
      <div
        className={cn(
          "panel relative z-10 w-full animate-[float-soft_0.3s_ease-out] overflow-hidden rounded-t-3xl sm:rounded-3xl",
          widths[size],
        )}
        style={{ maxHeight: "92vh" }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h3 className="font-display text-[15.5px] font-semibold text-ink">{title}</h3>
            {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-dim">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="thin-scroll overflow-y-auto px-5 py-4" style={{ maxHeight: "calc(92vh - 150px)" }}>
          {children}
        </div>
        {footer && <div className="border-t border-white/[0.07] px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
