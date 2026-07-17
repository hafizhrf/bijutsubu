import { cn } from "@/lib/utils";
import type { TextWidget, TextWidgetVariant } from "@/types/dashboard";

interface TextBlockProps {
  widget: TextWidget;
}

const VARIANT_CLASSES: Record<TextWidgetVariant, string> = {
  heading: "text-3xl font-bold tracking-tight text-ink",
  subheading: "text-xl font-semibold text-ink",
  body: "whitespace-pre-line text-sm leading-relaxed text-ink-muted",
  quote: "whitespace-pre-line border-l-4 border-accent-blue pl-4 italic text-ink-muted",
};

/**
 * Static page copy rendered directly on the canvas (no card chrome).
 * Content is plain text — React escapes it; never rendered as HTML.
 */
export function TextBlock({ widget }: TextBlockProps) {
  if (widget.variant === "heading") {
    return (
      <div>
        <p className={VARIANT_CLASSES.heading}>{widget.content}</p>
        <span
          aria-hidden="true"
          className="mt-2 block h-1 w-10 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#ec4899]"
        />
      </div>
    );
  }
  return <p className={cn(VARIANT_CLASSES[widget.variant])}>{widget.content}</p>;
}
