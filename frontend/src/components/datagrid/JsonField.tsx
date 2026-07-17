import { cn } from "@/lib/utils";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";

interface JsonFieldProps {
  id?: string;
  /** "array" or "object" — drives the fence label and the placeholder. */
  fieldType: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Validation message from jsonInputError, or null when valid. */
  error: string | null;
}

/**
 * Code-block styled editor for array/object fields — a fenced snippet like a
 * markdown ``` block: dark header naming the expected shape, monospace body,
 * and a Format action that pretty-prints valid JSON.
 */
export function JsonField({ id, fieldType, value, onChange, disabled, error }: JsonFieldProps) {
  const isArray = fieldType.toLowerCase() === "array";
  const canFormat = !error && value.trim() !== "" && !disabled;

  function handleFormat() {
    if (!canFormat) return;
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // Unreachable while error is null; keep the draft untouched regardless.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "overflow-hidden rounded-xl border transition-colors focus-within:ring-2",
          error
            ? "border-rose-400 focus-within:ring-rose-300"
            : "border-border-soft focus-within:border-accent-blue/50 focus-within:ring-accent-blue/30",
        )}
      >
        <div className="flex items-center justify-between bg-ink px-3 py-1.5">
          <span className="font-mono text-[11px] text-white/60">
            {isArray ? "[ ] json · array" : "{ } json · object"}
          </span>
          <button
            type="button"
            onClick={handleFormat}
            disabled={!canFormat}
            className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            Format
          </button>
        </div>
        <textarea
          id={id}
          value={value}
          rows={4}
          spellCheck={false}
          placeholder={isArray ? '[\n  "value"\n]' : '{\n  "key": "value"\n}'}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={cn(
            "block w-full resize-y bg-[#12141a] px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-100 [caret-color:white] placeholder:text-neutral-100/30 focus:outline-none disabled:opacity-50",
            THIN_SCROLLBAR_CLASS,
          )}
        />
      </div>
      {error && <p className="animate-fade-in text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
