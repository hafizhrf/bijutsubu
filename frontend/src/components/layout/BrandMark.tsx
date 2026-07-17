import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const MASK_STYLE: CSSProperties = {
  maskImage: "url(/bijutsubu_logo.svg)",
  maskRepeat: "no-repeat",
  maskPosition: "center",
  maskSize: "contain",
  WebkitMaskImage: "url(/bijutsubu_logo.svg)",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  WebkitMaskSize: "contain",
};

/**
 * Product logo — a single "B" glyph. Rendered as a CSS mask over a themed
 * background color so the mark always matches the active theme (an <img>
 * can't be recolored). Defaults to sidebar-ink; override via className.
 */
export function BrandMark({ className }: { className?: string }) {
  return <span role="img" aria-label="Bijustubu" className={cn("inline-block shrink-0 bg-sidebar-ink", className)} style={MASK_STYLE} />;
}
