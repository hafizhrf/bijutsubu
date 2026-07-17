import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getCollections } from "@/api/collections";
import type { CollectionField, MetaRelation, RowRecord } from "@/types/collections";
import {
  castCellInput,
  cellEditText,
  cellInputError,
  isInvalidNumberInput,
  jsonInputError,
} from "@/components/datagrid/EditableCell";
import { JsonField } from "@/components/datagrid/JsonField";
import { RelationPicker, relationForField } from "@/components/datagrid/RelationPicker";
import type { FieldRelation } from "@/components/datagrid/RelationPicker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading03Icon,
} from "@hugeicons/core-free-icons";

const FIELD_INPUT_CLASS =
  "w-full rounded-xl border border-border-soft bg-surface-muted px-3 py-2 text-sm text-ink transition-colors placeholder:text-ink-muted/70 focus:border-accent-blue/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-blue/30 disabled:opacity-50";

interface RowEditorDialogProps {
  mode: "create" | "edit";
  /** Required in edit mode; ignored for create. */
  row?: RowRecord | null;
  fields: CollectionField[];
  collectionName: string;
  relations: MetaRelation[];
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  /** Edit: only changed fields. Create: every field (nulls included). */
  onSave: (set: Record<string, unknown>) => void;
}

/** Text-draft representation for non-relation fields. */
function initialTextDraft(field: CollectionField, value: unknown): string {
  const type = field.type.toLowerCase();
  if (type === "boolean") {
    return value === true ? "true" : value === false ? "false" : "";
  }
  // JSON fields open pretty-printed — they edit in a code-block textarea.
  if ((type === "array" || type === "object") && value !== null && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return cellEditText(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Two-column form editing every field of one row (or drafting a new one).
 * Relation-backed fields render a foreign-key picker over the related
 * collection instead of a raw input; many-to-many stores an array of keys.
 */
export function RowEditorDialog({
  mode,
  row,
  fields,
  collectionName,
  relations,
  saving,
  error,
  onClose,
  onSave,
}: RowEditorDialogProps) {
  const collectionsQuery = useQuery({ queryKey: ["collections"], queryFn: getCollections });
  const displayNames = useMemo(
    () =>
      Object.fromEntries(
        (collectionsQuery.data ?? []).map((c) => [c.name, c.displayName]),
      ) as Record<string, string>,
    [collectionsQuery.data],
  );

  const fieldRelations = useMemo(() => {
    const map = new Map<string, FieldRelation>();
    for (const field of fields) {
      const relation = relationForField(collectionName, field, relations);
      if (relation) map.set(field.name, relation);
    }
    return map;
  }, [fields, collectionName, relations]);

  // Relation fields keep their real value (key or key array); everything else
  // is drafted as text and cast on save.
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      if (fieldRelations.has(field.name)) continue;
      initial[field.name] = initialTextDraft(field, row?.[field.name]);
    }
    return initial;
  });
  const [relationDrafts, setRelationDrafts] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      const relation = fieldRelations.get(field.name);
      if (!relation) continue;
      const value = row?.[field.name];
      initial[field.name] = relation.multiple ? (Array.isArray(value) ? value : []) : (value ?? null);
    }
    return initial;
  });

  const hasInvalid = fields.some(
    (field) =>
      !fieldRelations.has(field.name) &&
      cellInputError(textDrafts[field.name] ?? "", field.type) !== null,
  );

  function draftValue(field: CollectionField): unknown {
    if (fieldRelations.has(field.name)) {
      return relationDrafts[field.name];
    }
    const raw = textDrafts[field.name] ?? "";
    if (field.type.toLowerCase() === "boolean") {
      return raw === "" ? null : raw === "true";
    }
    return castCellInput(raw, field.type);
  }

  function handleSave() {
    if (saving || hasInvalid) return;
    const set: Record<string, unknown> = {};
    for (const field of fields) {
      const next = draftValue(field);
      if (mode === "create" || !sameValue(next, row?.[field.name])) {
        set[field.name] = next;
      }
    }
    if (mode === "edit" && Object.keys(set).length === 0) {
      onClose();
      return;
    }
    onSave(set);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add row" : "Edit row"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? (
              <>New row in this collection — relation fields pick from their linked collection.</>
            ) : (
              <>
                <span className="font-mono text-xs">…{row?._id.slice(-6)}</span> — only changed
                fields are saved.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "grid max-h-[62vh] grid-cols-1 content-start gap-x-4 gap-y-3 overflow-y-auto pr-1 sm:grid-cols-2",
            THIN_SCROLLBAR_CLASS,
          )}
        >
          {fields.map((field) => {
            const type = field.type.toLowerCase();
            const relation = fieldRelations.get(field.name);
            const isWide = relation?.multiple || (!relation && (type === "array" || type === "object"));
            const raw = textDrafts[field.name] ?? "";
            const numeric = type === "number";
            const invalid = !relation && isInvalidNumberInput(raw, field.type);

            return (
              <div
                key={field.name}
                className={cn("flex min-w-0 flex-col gap-1.5", isWide && "sm:col-span-2")}
              >
                <Label htmlFor={`row-edit-${field.name}`} className="flex items-baseline gap-1.5">
                  <span className="truncate">{field.name}</span>
                  <span className="shrink-0 text-[10px] font-normal text-ink-muted">
                    {relation
                      ? `${relation.type} → ${displayNames[relation.targetCollection] ?? relation.targetCollection}`
                      : field.type}
                  </span>
                </Label>

                {relation ? (
                  <RelationPicker
                    relation={relation}
                    targetDisplayName={displayNames[relation.targetCollection]}
                    value={relationDrafts[field.name]}
                    onChange={(next) =>
                      setRelationDrafts((prev) => ({ ...prev, [field.name]: next }))
                    }
                    disabled={saving}
                    className={FIELD_INPUT_CLASS}
                  />
                ) : type === "boolean" ? (
                  <select
                    id={`row-edit-${field.name}`}
                    value={raw}
                    onChange={(event) =>
                      setTextDrafts((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                    disabled={saving}
                    className={FIELD_INPUT_CLASS}
                  >
                    <option value="">—</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : type === "array" || type === "object" ? (
                  <JsonField
                    id={`row-edit-${field.name}`}
                    fieldType={type}
                    value={raw}
                    onChange={(next) =>
                      setTextDrafts((prev) => ({ ...prev, [field.name]: next }))
                    }
                    disabled={saving}
                    error={jsonInputError(raw, field.type)}
                  />
                ) : type === "date" ? (
                  <DateTimePicker
                    id={`row-edit-${field.name}`}
                    value={raw}
                    onChange={(next) =>
                      setTextDrafts((prev) => ({ ...prev, [field.name]: next }))
                    }
                    disabled={saving}
                    className={FIELD_INPUT_CLASS}
                  />
                ) : (
                  <input
                    id={`row-edit-${field.name}`}
                    value={raw}
                    placeholder={field.type}
                    inputMode={numeric ? "decimal" : undefined}
                    onChange={(event) =>
                      setTextDrafts((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleSave();
                    }}
                    disabled={saving}
                    className={cn(
                      FIELD_INPUT_CLASS,
                      numeric && "text-right tabular-nums",
                      invalid && "border-rose-400 focus:ring-rose-300",
                    )}
                    title={invalid ? "Not a valid number" : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="animate-fade-in text-xs text-rose-600">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || hasInvalid}>
            {saving && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
            {mode === "create" ? "Add row" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
