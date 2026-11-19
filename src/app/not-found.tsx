import Link from "next/link";
import { Compass, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 map-backdrop">
      <div className="panel max-w-md rounded-3xl p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan/25 bg-cyan/10">
          <Compass size={22} className="text-cyan" />
        </span>
        <h1 className="mt-4 font-display text-[22px] font-bold text-ink">Page introuvable</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
          Cette zone du campus n&apos;existe pas encore dans le prototype.
        </p>
        <Link
          href="/map"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan px-4 py-2.5 text-[13px] font-semibold text-[#04141b] transition-colors hover:bg-[#5ce2ff]"
        >
          <Home size={14} /> Retour à la carte
        </Link>
      </div>
    </div>
  );
}
