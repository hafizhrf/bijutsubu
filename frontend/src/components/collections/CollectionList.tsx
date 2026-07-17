import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCollectionSample } from "@/api/collections";
import { cn } from "@/lib/utils";
import type { CollectionField, CollectionSample, MetaCollection } from "@/types/collections";
import { Badge } from "@/components/ui/badge";
import {
  DataCellValue,
  THIN_SCROLLBAR_CLASS,
  formatIsoDate,
  isNumericColumn,
} from "@/components/ui/data-cell";
import { Lottie } from "@/components/ui/lottie";
import loadingAnimation from "@/assets/lottie/loading.lottie";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  InboxIcon,
} from "@hugeicons/core-free-icons";

const ROW_GRID = "grid grid-cols-[1fr_5rem_6rem_7rem_10rem] items-center gap-4";

const FIELD_CHIP_LIMIT = 10;

function fieldTypeDotClass(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("string") || normalized.includes("text")) return "bg-accent-blue";
  if (
    normalized.includes("number") ||
    normalized.includes("int") ||
    normalized.includes("float") ||
    normalized.includes("decimal")
  ) {
    return "bg-emerald-500";
  }
  if (normalized.includes("bool")) return "bg-amber-500";
  if (normalized.includes("date") || normalized.includes("time")) return "bg-violet-500";
  return "bg-ink-muted";
}

function FieldChips({ fields }: { fields: CollectionField[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? fields : fields.slice(0, FIELD_CHIP_LIMIT);
  const hiddenCount = fields.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((field) => (
        <span
          key={field.name}
          title={`${field.name}: ${field.type}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface px-2.5 py-1"
        >
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fieldTypeDotClass(field.type))}
          />
          <span className="max-w-[10rem] truncate text-xs font-medium text-ink">{field.name}</span>
          <span className="text-[10px] text-ink-muted">{field.type}</span>
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="inline-flex items-center rounded-full border border-border-soft bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          +{hiddenCount} more
        </button>
      )}
      {showAll && fields.length > FIELD_CHIP_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function SampleTable({ sample }: { sample: CollectionSample }) {
  const numericFields = new Set(
    sample.fields
      .filter((field) => isNumericColumn(sample.rows.map((row) => row[field.name])))
      .map((field) => field.name),
  );

  return (
    <div className="animate-fade-in overflow-hidden rounded-2xl border border-border-soft bg-surface">
      <div className={cn("overflow-x-auto", THIN_SCROLLBAR_CLASS)}>
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-muted/50 backdrop-blur-sm">
            <tr>
              {sample.fields.map((field) => (
                <th
                  key={field.name}
                  className={cn(
                    "whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]",
                    numericFields.has(field.name) && "text-right",
                  )}
                >
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {sample.rows.map((row, index) => (
              <tr key={index} className="transition-colors hover:bg-surface-muted/60">
                {sample.fields.map((field) => (
                  <td
                    key={field.name}
                    className={cn(
                      "px-4 py-3 text-sm text-ink",
                      numericFields.has(field.name) && "text-right",
                    )}
                  >
                    <DataCellValue value={row[field.name]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CollectionRowProps {
  collection: MetaCollection;
}

function CollectionRow({ collection }: CollectionRowProps) {
  const [expanded, setExpanded] = useState(false);

  const sampleQuery = useQuery({
    queryKey: ["collection-sample", collection.name],
    queryFn: () => getCollectionSample(collection.name, 5),
    enabled: expanded,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          ROW_GRID,
          "w-full rounded-xl px-3 py-3 text-left transition-colors duration-150 ease-in-out hover:bg-surface-muted/60",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={ArrowRight01Icon}
            className={cn(
              "h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ease-out",
              expanded && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-ink">{collection.displayName}</span>
            <span className="truncate text-xs text-ink-muted">{collection.name}</span>
          </span>
        </span>
        <span className="text-right text-sm tabular-nums text-ink">
          {collection.fields.length.toLocaleString()}
        </span>
        <span className="text-right text-sm tabular-nums text-ink">
          {collection.rowCount.toLocaleString()}
        </span>
        <span>
          <Badge
            variant={collection.createdVia === "auto" ? "muted" : "blue"}
            className="w-fit px-2.5 py-0.5 text-[11px] font-medium capitalize"
          >
            {collection.createdVia}
          </Badge>
        </span>
        <span className="text-xs tabular-nums text-ink-muted" title={collection.updatedAt}>
          {formatIsoDate(collection.updatedAt)}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-3 py-2 pb-5 pl-11 pr-3">
            <FieldChips fields={collection.fields} />

            {sampleQuery.isLoading && (
              <p className="animate-fade-in text-xs text-ink-muted">Loading sample rows…</p>
            )}
            {sampleQuery.isError && (
              <p className="animate-fade-in text-xs text-rose-600">Could not load sample rows.</p>
            )}
            {sampleQuery.data && sampleQuery.data.rows.length === 0 && (
              <div className="flex animate-fade-in flex-col items-center gap-1.5 rounded-2xl border border-border-soft bg-surface-muted/40 px-4 py-8 text-ink-muted">
                <HugeiconsIcon icon={InboxIcon} className="h-5 w-5" />
                <p className="text-xs">No sample rows available.</p>
              </div>
            )}
            {sampleQuery.data && sampleQuery.data.rows.length > 0 && (
              <SampleTable sample={sampleQuery.data} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CollectionListProps {
  collections: MetaCollection[];
  isLoading?: boolean;
  emptyState?: ReactNode;
}

export function CollectionList({ collections, isLoading, emptyState }: CollectionListProps) {
  if (isLoading) {
    return (
      <div className="flex animate-fade-in flex-col items-center gap-2 py-8">
        <Lottie src={loadingAnimation} className="h-16 w-16" />
        <p className="text-sm text-ink-muted">Loading collections…</p>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <>{emptyState ?? <p className="py-10 text-center text-sm text-ink-muted">No collections yet.</p>}</>
    );
  }

  return (
    <div className={cn("overflow-x-auto", THIN_SCROLLBAR_CLASS)}>
      <div className="min-w-[720px]">
        <div
          className={cn(
            ROW_GRID,
            "border-b border-border-soft px-3 pb-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted",
          )}
        >
          <span className="pl-6">Name</span>
          <span className="text-right">Fields</span>
          <span className="text-right">Rows</span>
          <span>Source</span>
          <span>Updated</span>
        </div>
        <div className="divide-y divide-border-soft">
          {collections.map((collection) => (
            <CollectionRow key={collection._id} collection={collection} />
          ))}
        </div>
      </div>
    </div>
  );
}
