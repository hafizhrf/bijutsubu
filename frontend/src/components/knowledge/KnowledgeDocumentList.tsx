import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  EyeIcon,
  File02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { formatIsoDate } from "@/components/ui/data-cell";
import type { KnowledgeDocument } from "@/types/knowledge";

const PENDING_STATUSES = new Set([
  "queued",
  "waiting",
  "parsing",
  "cleaning",
  "splitting",
  "indexing",
]);

export function isIndexingPending(status: string): boolean {
  return PENDING_STATUSES.has(status);
}

function StatusChip({ status }: { status: string }) {
  const base = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold";
  if (status === "completed") {
    return (
      <span className={cn(base, "bg-emerald-100 text-emerald-700")}>
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3 w-3" /> Ready
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={cn(base, "bg-rose-100 text-rose-700")}>
        <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" /> Failed
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-amber-100 text-amber-700")}>
      <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" /> Indexing
    </span>
  );
}

interface KnowledgeDocumentListProps {
  documents: KnowledgeDocument[];
  onView: (doc: KnowledgeDocument) => void;
  onDelete: (doc: KnowledgeDocument) => void;
}

/** Dense row list of knowledge-base documents with status and actions. */
export function KnowledgeDocumentList({ documents, onView, onDelete }: KnowledgeDocumentListProps) {
  return (
    <ul className="flex flex-col divide-y divide-border-soft">
      {documents.map((doc) => (
        <li key={doc.id} className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue">
            <HugeiconsIcon icon={File02Icon} className="h-4 w-4" />
          </div>
          <button
            type="button"
            onClick={() => onView(doc)}
            className="block min-w-0 flex-1 text-left"
            title={`Open ${doc.name}`}
          >
            <p className="truncate text-sm font-medium text-ink">{doc.name}</p>
            <p className="truncate text-[11px] text-ink-muted">
              {doc.wordCount > 0 && <>{doc.wordCount.toLocaleString()} words · </>}
              {formatIsoDate(doc.createdAt)}
            </p>
          </button>
          <StatusChip status={doc.indexingStatus} />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="View content"
              onClick={() => onView(doc)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition-[opacity,color,background-color] hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <HugeiconsIcon icon={EyeIcon} className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Delete document"
              onClick={() => onDelete(doc)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition-[opacity,color,background-color] hover:bg-rose-100 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
