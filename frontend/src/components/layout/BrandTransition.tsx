import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { BrandMark } from "@/components/layout/BrandMark";
import { cn } from "@/lib/utils";

const SNAPPY = "cubic-bezier(0.16,1,0.3,1)";
/** Must match the gap-4 between logo and wordmark below. */
const GAP_PX = 16;

/**
 * Full-screen branded transition played on login and logout:
 * canvas-colored cover fades in (black-ish in dark mode, white-ish in light)
 * → logo fades in centered → the whole group glides left while the wordmark
 * fades in beside it → everything fades out revealing the destination route.
 * The route change runs at the "covered" moment so the app swaps screens
 * invisibly.
 *
 * The push is done by translating the group (logo starts offset so it sits at
 * the exact screen center), NOT by clipping the text with overflow-hidden —
 * a clip reveal reads as the text sliding out from behind an invisible box.
 */
type Phase = "idle" | "cover" | "logo" | "wordmark" | "exit";

interface BrandTransitionState {
  phase: Phase;
  play: (onCovered: () => void) => void;
}

export const useBrandTransition = create<BrandTransitionState>((set, get) => ({
  phase: "idle",
  play: (onCovered) => {
    if (get().phase !== "idle") return;
    set({ phase: "cover" });
    window.setTimeout(() => {
      onCovered();
      set({ phase: "logo" });
    }, 320);
    window.setTimeout(() => set({ phase: "wordmark" }), 800);
    window.setTimeout(() => set({ phase: "exit" }), 1750);
    window.setTimeout(() => set({ phase: "idle" }), 2300);
  },
}));

/** Kick off the transition; `onCovered` fires once the screen is hidden. */
export function playBrandTransition(onCovered: () => void): void {
  useBrandTransition.getState().play(onCovered);
}

export function BrandTransition() {
  const phase = useBrandTransition((state) => state.phase);
  const textRef = useRef<HTMLSpanElement>(null);
  const [logoShift, setLogoShift] = useState(0);
  // Both the cover fade-in and the exit fade-out run through the same CSS
  // transition (no keyframe animation): a fill-mode animation would pin
  // opacity at 1 and make the exit cut instead of fade. The double rAF lets
  // the browser paint the opacity-0 frame before flipping to 1.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (phase === "cover") {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    if (phase === "idle") setShown(false);
  }, [phase]);

  // The wordmark renders from the start (opacity 0), so its width is
  // measurable; shifting the group by half of (text + gap) puts the logo at
  // the exact screen center before the push.
  useLayoutEffect(() => {
    if (phase === "cover" && textRef.current) {
      setLogoShift((textRef.current.offsetWidth + GAP_PX) / 2);
    }
  }, [phase]);

  if (phase === "idle") return null;

  const logoVisible = phase !== "cover";
  const wordmarkVisible = phase === "wordmark" || phase === "exit";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center bg-canvas transition-opacity",
        // Fast fade-in (the screen must be fully covered before onCovered
        // fires at 320ms), slower relaxed fade-out.
        phase === "exit" ? "duration-500" : "duration-300",
        shown && phase !== "exit" ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className="flex items-center gap-4 transition-transform duration-700"
        style={{
          transform: `translateX(${wordmarkVisible ? 0 : logoShift}px)`,
          transitionTimingFunction: SNAPPY,
        }}
      >
        <BrandMark
          className={cn(
            "h-14 w-14 shrink-0 bg-ink transition-all duration-500",
            logoVisible ? "scale-100 opacity-100" : "scale-75 opacity-0",
          )}
        />
        <span
          ref={textRef}
          className={cn(
            "whitespace-nowrap text-4xl font-bold tracking-tight text-ink transition-[opacity,translate] delay-150 duration-500",
            wordmarkVisible ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0",
          )}
        >
          Bijustubu
        </span>
      </div>
    </div>
  );
}
