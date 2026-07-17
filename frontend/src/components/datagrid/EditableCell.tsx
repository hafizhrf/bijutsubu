import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DataCellValue } from "@/components/ui/data-cell";
import { DateTimePicker } from "@/components/ui/datetime-picker";

/** Text shown in the input when a cell enters edit mode. */
export function cellEditText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Cast raw input text to the collection field's declared type. */
export function castCellInput(raw: string, fieldType: string): unknown {
  const type = fieldType.toLowerCase();
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (type === "number") return Number(trimmed);
  if (type === "array" || type === "object") {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function isInvalidNumberInput(raw: string, fieldType: string): boolean {
  if (fieldType.toLowerCase() !== "number") return false;
  const trimmed = raw.trim();
  return trimmed !== "" && Number.isNaN(Number(trimmed));
}

/**
 * Validation for array/object fields: the text must parse as JSON of the
 * matching shape (empty = null = fine). Returns a message, or null when valid.
 */
export function jsonInputError(raw: string, fieldType: string): string | null {
  const type = fieldType.toLowerCase();
  if (type !== "array" && type !== "object") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "Not valid JSON";
  }
  if (type === "array" && !Array.isArray(parsed)) {
    return 'Must be a JSON array — e.g. ["a", "b"]';
  }
  if (type === "object" && (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")) {
    return 'Must be a JSON object — e.g. { "key": "value" }';
  }
  return null;
}

/** Any type-level validation error for a drafted cell value. */
export function cellInputError(raw: string, fieldType: string): string | null {
  if (isInvalidNumberInput(raw, fieldType)) return "Not a valid number";
  return jsonInputError(raw, fieldType);
}

export const CELL_INPUT_CLASS =
  "w-full min-w-24 rounded-lg border border-accent-blue/50 bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent-blue/40";

interface BooleanCellEditorProps {
  value: unknown;
  onDone: (commit: boolean, next: unknown) => void;
}

function BooleanCellEditor({ value, onDone }: BooleanCellEditorProps) {
  const initial = value === true ? "true" : value === false ? "false" : "null";
  const committed = useRef(false);

  return (
    <select
      autoFocus
      defaultValue={initial}
      className={CELL_INPUT_CLASS}
      onChange={(event) => {
        committed.current = true;
        const raw = event.target.value;
        onDone(true, raw === "null" ? null : raw === "true");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          committed.current = true;
          onDone(false, null);
        }
      }}
      onBlur={() => {
        if (!committed.current) onDone(false, null);
      }}
    >
      <option value="true">Yes</option>
      <option value="false">No</option>
      <option value="null">—</option>
    </select>
  );
}

interface TextCellEditorProps {
  value: unknown;
  fieldType: string;
  numeric: boolean;
  onDone: (commit: boolean, next: unknown) => void;
}

function TextCellEditor({ value, fieldType, numeric, onDone }: TextCellEditorProps) {
  const [draft, setDraft] = useState(() => cellEditText(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const errorText = cellInputError(draft, fieldType);
  const invalid = errorText !== null;

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (finished.current) return;
    finished.current = true;
    onDone(commit && !invalid, castCellInput(draft, fieldType));
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={draft}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !invalid) finish(true);
        if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(!invalid)}
      className={cn(
        CELL_INPUT_CLASS,
        numeric && "text-right tabular-nums",
        invalid && "border-rose-400 focus:ring-rose-300",
      )}
      title={errorText ?? undefined}
    />
  );
}

interface DateCellEditorProps {
  value: unknown;
  onDone: (commit: boolean, next: unknown) => void;
}

/** Inline date editing opens the design-system picker, not a text input. */
function DateCellEditor({ value, onDone }: DateCellEditorProps) {
  const [draft, setDraft] = useState(() => cellEditText(value));
  const finished = useRef(false);

  return (
    <DateTimePicker
      autoOpen
      value={draft}
      onChange={setDraft}
      className={CELL_INPUT_CLASS}
      onDismiss={(committed) => {
        if (finished.current) return;
        finished.current = true;
        onDone(committed, draft.trim() === "" ? null : draft);
      }}
    />
  );
}

interface EditableCellProps {
  value: unknown;
  fieldType: string;
  numeric: boolean;
  onCommit: (next: unknown) => void;
}

/**
 * Display cell that switches to an in-place editor on double-click.
 * Enter/blur commits, Escape cancels; values are cast by the field's type.
 */
export function EditableCell({ value, fieldType, numeric, onCommit }: EditableCellProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
        className="-mx-2 -my-1 cursor-cell rounded-lg px-2 py-1 transition-colors hover:bg-surface-muted/80"
      >
        <DataCellValue value={value} />
      </div>
    );
  }

  const handleDone = (commit: boolean, next: unknown) => {
    setEditing(false);
    if (commit && !Object.is(next, value)) onCommit(next);
  };

  if (fieldType.toLowerCase() === "boolean") {
    return <BooleanCellEditor value={value} onDone={handleDone} />;
  }
  if (fieldType.toLowerCase() === "date") {
    return <DateCellEditor value={value} onDone={handleDone} />;
  }
  return (
    <TextCellEditor value={value} fieldType={fieldType} numeric={numeric} onDone={handleDone} />
  );
}
