import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { CollectionField } from "@/types/collections";
import type { CollectionFlowNode } from "./types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
} from "@hugeicons/core-free-icons";

const MAX_VISIBLE_FIELDS = 8;

const rowCountFormatter = new Intl.NumberFormat("en", { notation: "compact" });

/**
 * Mongo's built-in id, shown as a pseudo-field so relations can target it —
 * it's the natural join key for one-to-many links but never appears in the
 * user-defined field list.
 */
const ID_FIELD: CollectionField = { name: "_id", type: "objectId" };

function fieldDotColor(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("objectid")) return "#f43f5e";
  if (normalized.includes("string") || normalized.includes("text")) return "#5b7cfa";
  if (
    normalized.includes("number") ||
    normalized.includes("int") ||
    normalized.includes("float") ||
    normalized.includes("decimal")
  ) {
    return "#10b981";
  }
  if (normalized.includes("bool")) return "#f59e0b";
  if (normalized.includes("date") || normalized.includes("time")) return "#8b5cf6";
  return "#a1a09b";
}

function selectVisibleFields(
  fields: CollectionField[],
  connectedFields: string[],
): { visible: CollectionField[]; hiddenCount: number } {
  if (fields.length <= MAX_VISIBLE_FIELDS + 1) {
    return { visible: fields, hiddenCount: 0 };
  }
  const connected = new Set(connectedFields);
  const visible = fields.filter(
    (field, index) => index < MAX_VISIBLE_FIELDS || connected.has(field.name),
  );
  return { visible, hiddenCount: fields.length - visible.length };
}

export const CollectionNode = memo(function CollectionNode({
  data,
  selected,
}: NodeProps<CollectionFlowNode>) {
  const { collection, connectedFields } = data;
  const { visible, hiddenCount } = selectVisibleFields(collection.fields, connectedFields);
  // _id leads the list and is never truncated away.
  const rows = [ID_FIELD, ...visible.filter((field) => field.name !== "_id")];

  return (
    <div
      className={cn(
        "w-64 rounded-2xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-150",
        selected
          ? "border-accent-blue/60 shadow-lg shadow-accent-blue/10"
          : "border-border-soft hover:border-accent-blue/30",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-soft px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
            <HugeiconsIcon icon={Database01Icon} className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-semibold text-ink" title={collection.displayName}>
            {collection.displayName}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
          {rowCountFormatter.format(collection.rowCount)} rows
        </span>
      </div>

      <div className="py-1.5">
        {rows.map((field) => (
          <div
            key={field.name}
            className="relative flex items-center gap-2 px-3.5 py-[5px] text-xs"
          >
            <Handle
              type="target"
              position={Position.Left}
              id={field.name}
              className="relations-field-handle"
            />
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: fieldDotColor(field.type) }}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-ink",
                field.name === "_id" && "font-mono text-[11px] text-ink-muted",
              )}
              title={field.name}
            >
              {field.name}
            </span>
            <span className="shrink-0 text-[10px] text-ink-muted">{field.type}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={field.name}
              className="relations-field-handle"
            />
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="px-3.5 py-[5px] text-[11px] italic text-ink-muted">
            +{hiddenCount} more field{hiddenCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
});
