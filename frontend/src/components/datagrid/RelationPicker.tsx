import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRows } from "@/api/collections";
import type { CollectionField, MetaRelation, RelationType } from "@/types/collections";
import { cn } from "@/lib/utils";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Search01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

export interface FieldRelation {
  /** Collection the values come from. */
  targetCollection: string;
  /** Field on the target whose value is stored (often _id). */
  targetField: string;
  type: RelationType;
  /** Store an array of keys (many-to-many, or the field itself is an array). */
  multiple: boolean;
}

/**
 * The relation this field participates in, if any — checked in both
 * directions so editing either side of a link gets a picker.
 */
export function relationForField(
  collectionName: string,
  field: CollectionField,
  relations: MetaRelation[],
): FieldRelation | null {
  const isArray = field.type.toLowerCase() === "array";
  for (const relation of relations) {
    if (relation.fromCollection === collectionName && relation.fromField === field.name) {
      return {
        targetCollection: relation.toCollection,
        targetField: relation.toField,
        type: relation.type,
        multiple: relation.type === "many-to-many" || isArray,
      };
    }
    if (
      relation.toCollection === collectionName &&
      relation.toField === field.name &&
      relation.fromCollection !== collectionName
    ) {
      return {
        targetCollection: relation.fromCollection,
        targetField: relation.fromField,
        type: relation.type,
        multiple: relation.type === "many-to-many" || isArray,
      };
    }
  }
  return null;
}

const OPTIONS_LIMIT = 200;

function sameKey(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

interface RelationPickerProps {
  relation: FieldRelation;
  /** Pretty name of the target collection (falls back to its machine name). */
  targetDisplayName?: string;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** Trigger styling — pass the same class the sibling inputs use. */
  className?: string;
}

/**
 * Foreign-key value picker for relation-backed fields: lists rows of the
 * related collection with a human-readable label, stores the target field's
 * value — one key for one-to-* relations, an array of keys for many-to-many.
 */
export function RelationPicker({
  relation,
  targetDisplayName,
  value,
  onChange,
  disabled,
  className,
}: RelationPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const optionsQuery = useQuery({
    queryKey: ["relation-options", relation.targetCollection],
    queryFn: () => getRows(relation.targetCollection, 0, OPTIONS_LIMIT),
  });

  const rows = optionsQuery.data?.rows ?? [];
  const total = optionsQuery.data?.total ?? 0;

  /** Human label per option: the target's first string field, else its key. */
  const labelField = useMemo(() => {
    const fields = optionsQuery.data?.fields ?? [];
    return fields.find((f) => f.name !== "_id" && f.type.toLowerCase() === "string")?.name ?? null;
  }, [optionsQuery.data?.fields]);

  const selectedKeys: unknown[] = relation.multiple
    ? Array.isArray(value)
      ? value
      : []
    : value === null || value === undefined || value === ""
      ? []
      : [value];

  function labelFor(key: unknown): string {
    const row = rows.find((r) => sameKey(r[relation.targetField], key));
    const label = row && labelField ? row[labelField] : null;
    return label !== null && label !== undefined && label !== "" ? String(label) : String(key);
  }

  function toggle(key: unknown) {
    if (relation.multiple) {
      const next = selectedKeys.some((k) => sameKey(k, key))
        ? selectedKeys.filter((k) => !sameKey(k, key))
        : [...selectedKeys, key];
      onChange(next);
    } else {
      onChange(sameKey(selectedKeys[0], key) ? null : key);
      setOpen(false);
    }
  }

  const query = search.trim().toLowerCase();
  const visibleRows = query
    ? rows.filter((row) => {
        const key = String(row[relation.targetField] ?? "").toLowerCase();
        const label = labelField ? String(row[labelField] ?? "").toLowerCase() : "";
        return key.includes(query) || label.includes(query);
      })
    : rows;

  const targetName = targetDisplayName ?? relation.targetCollection;

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className={cn(
          "flex min-h-9 cursor-pointer items-center justify-between gap-2",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {selectedKeys.length === 0 ? (
            <span className="text-ink-muted/70">Pick from {targetName}…</span>
          ) : relation.multiple ? (
            selectedKeys.map((key) => (
              <span
                key={String(key)}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-blue/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent-blue"
              >
                <span className="truncate">{labelFor(key)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(key)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(key);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent-blue/20"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-2.5 w-2.5" />
                </button>
              </span>
            ))
          ) : (
            <span className="truncate">{labelFor(selectedKeys[0])}</span>
          )}
        </div>
        <HugeiconsIcon icon={UnfoldMoreIcon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      </div>

      {open && (
        <>
          {/* click-away catcher */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border-soft bg-surface shadow-card animate-scale-in">
            <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
              <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                }}
                placeholder={`Search ${targetName}…`}
                className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none"
              />
            </div>
            <div className={cn("max-h-52 overflow-y-auto p-1", THIN_SCROLLBAR_CLASS)}>
              {optionsQuery.isLoading ? (
                <p className="px-3 py-3 text-xs text-ink-muted">Loading {targetName}…</p>
              ) : visibleRows.length === 0 ? (
                <p className="px-3 py-3 text-xs text-ink-muted">No matches.</p>
              ) : (
                visibleRows.map((row) => {
                  const key = row[relation.targetField];
                  const isSelected = selectedKeys.some((k) => sameKey(k, key));
                  return (
                    <button
                      key={row._id}
                      type="button"
                      onClick={() => toggle(key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-muted",
                        isSelected && "bg-accent-blue/5",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          isSelected
                            ? "border-accent-blue bg-accent-blue text-white"
                            : "border-border-soft",
                        )}
                      >
                        {isSelected && <HugeiconsIcon icon={Tick02Icon} className="h-2.5 w-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink">{labelFor(key)}</span>
                      <span className="max-w-28 shrink-0 truncate font-mono text-[10px] text-ink-muted">
                        {String(key)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {(total > OPTIONS_LIMIT || selectedKeys.length > 0) && (
              <div className="flex items-center justify-between gap-2 border-t border-border-soft px-3 py-1.5">
                <span className="text-[10px] text-ink-muted">
                  {total > OPTIONS_LIMIT ? `Showing first ${OPTIONS_LIMIT} of ${total}` : ""}
                </span>
                {selectedKeys.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange(relation.multiple ? [] : null)}
                    className="text-[11px] font-medium text-ink-muted transition-colors hover:text-rose-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
