import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { deleteKnowledgeDocument } from "@/api/knowledge";
import { Button } from "@/components/ui/button";
import { DependencyNote } from "@/components/ui/dependency-note";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KnowledgeDocument } from "@/types/knowledge";

interface DeleteKnowledgeDocumentDialogProps {
  doc: KnowledgeDocument | null;
  onClose: () => void;
}

export function DeleteKnowledgeDocumentDialog({ doc, onClose }: DeleteKnowledgeDocumentDialogProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteKnowledgeDocument(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge", "documents"] });
      onClose();
    },
  });

  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open && !deleteMutation.isPending) onClose();
      }}
    >
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            This permanently removes{" "}
            <span className="font-medium text-ink">{doc?.name}</span> from your knowledge base.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DependencyNote title="The chatbot will forget this document">
          <p>
            Its content is removed from retrieval immediately — answers will no longer be grounded
            on it.
          </p>
        </DependencyNote>

        {deleteMutation.isError && (
          <p className="animate-fade-in text-xs text-rose-600">
            Could not delete the document — try again shortly.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => doc && deleteMutation.mutate(doc.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending && (
              <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
            )}
            Delete document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
