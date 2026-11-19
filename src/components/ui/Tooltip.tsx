"use client";

import { cn } from "@/lib/utils";
import { type ReactNode, useState } from "react";

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "left" | "right" | "bottom";
}) {
  const [show, setShow] = useState(false);
  const pos = {
    top: "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2",
    left: "right-[calc(100%+8px)] top-1/2 -translate-y-1/2",
    right: "left-[calc(100%+8px)] top-1/2 -translate-y-1/2",
    bottom: "top-[calc(100%+6px)] left-1/2 -translate-x-1/2",
  }[side];

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          className={cn(
            "pointer-events-none absolute z-[80] whitespace-nowrap rounded-lg border border-white/10 bg-[#0b1220]/97 px-2 py-1 text-[11px] font-medium text-ink shadow-xl backdrop-blur-md",
            pos,
          )}
          role="tooltip"
        >
          {label}
        </span>
      )}
    </span>
  );
}
