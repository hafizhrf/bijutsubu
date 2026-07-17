import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { cn } from "@/lib/utils";

interface LottieProps {
  /** URL of a .lottie file (import it from @/assets/lottie). */
  src: string;
  /** Size the animation via the wrapper (e.g. "h-36 w-36"). */
  className?: string;
  loop?: boolean;
  speed?: number;
}

/**
 * Decorative dotLottie animation. Always paired with visible text by the
 * caller, so it's hidden from assistive tech and ignores pointer events.
 */
export function Lottie({ src, className, loop = true, speed }: LottieProps) {
  return (
    <div className={cn("pointer-events-none select-none", className)} aria-hidden="true">
      <DotLottieReact src={src} loop={loop} autoplay speed={speed} className="h-full w-full" />
    </div>
  );
}
