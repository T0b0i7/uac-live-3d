import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function id(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Deterministic 32-bit hash for stable pseudo-random visuals. */
export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const AVATAR_GRADIENTS = [
  ["#35D6F5", "#0EA5A0"],
  ["#8B5CF6", "#4C1D95"],
  ["#F59E0B", "#B45309"],
  ["#22C55E", "#0F7A3D"],
  ["#F43F5E", "#9F1239"],
  ["#38BDF8", "#1D4ED8"],
  ["#A78BFA", "#6D28D9"],
  ["#FBBF24", "#92400E"],
  ["#2DD4BF", "#0F766E"],
  ["#FB7185", "#BE123C"],
];

export function avatarGradient(seed: string) {
  const h = hashString(seed);
  const pair = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
}

export function compact(n: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return n > 1 ? many : one;
}
