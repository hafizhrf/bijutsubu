import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { getKnowledgeDocumentSegments } from "@/api/knowledge";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isIndexingPending } from "@/components/knowledge/KnowledgeDocumentList";
import type { KnowledgeDocument } from "@/types/knowledge";

interface DocumentViewerDialogProps {
  doc: KnowledgeDocument | null;
  onClose: () => void;
}

/** Read-only content viewer: the document's indexed segments, joined in order. */
export function DocumentViewerDialog({ doc, onClose }: DocumentViewerDialogProps) {
  const segmentsQuery = useQuery({
    queryKey: ["knowledge", "segments", doc?.id ?? ""],
    queryFn: () => getKnowledgeDocumentSegments(doc!.id),
    enabled: doc !== null,
    staleTime: 30_000,
  });

  const segments = segmentsQuery.data?.segments ?? [];

  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-full max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{doc?.name}</DialogTitle>
          <DialogDescription>
            {doc && doc.wordCount > 0
              ? `${doc.wordCount.toLocaleString()} words, as indexed in your knowledge base.`
              : "Content as indexed in your knowledge base."}
          </DialogDescription>
        </DialogHeader>

        {segmentsQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
            <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" /> Loading content…
          </div>
        ) : segmentsQuery.isError ? (
          <p className="py-8 text-center text-sm text-rose-600">
            Could not load the document content — try again shortly.
          </p>
        ) : segments.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            {doc && isIndexingPending(doc.indexingStatus)
              ? "Still indexing — the content will appear here once processing finishes."
              : "No indexed content found for this document."}
          </p>
        ) : (
          <div
            className={cn(
              "max-h-[60vh] overflow-y-auto rounded-xl border border-border-soft bg-surface-muted px-4 py-3",
              THIN_SCROLLBAR_CLASS,
            )}
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {segments.map((segment) => segment.content).join("\n\n")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
