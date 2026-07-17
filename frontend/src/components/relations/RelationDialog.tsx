import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { createRelation, deleteRelation, updateRelation } from "@/api/relations";
import type { UpdateRelationInput } from "@/api/relations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MetaRelation, RelationType } from "@/types/collections";
import { RELATION_TYPE_NAMES } from "./types";
import type { RelationEndpoints } from "./types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";

export type RelationDialogState =
  | { mode: "create"; draft: RelationEndpoints }
  | { mode: "edit"; relation: MetaRelation };

interface RelationDialogProps {
  state: RelationDialogState | null;
  onClose: () => void;
  /** collection name -> displayName */
  collectionLabels: Record<string, string>;
}

const RELATION_TYPES: RelationType[] = ["one-to-one", "one-to-many", "many-to-many"];

function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    if (data?.error === "collection_not_found") {
      return "One of the collections no longer exists. Refresh and try again.";
    }
    return data?.message ?? data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function EndpointSummary({
  endpoints,
  collectionLabels,
}: {
  endpoints: RelationEndpoints;
  collectionLabels: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-soft bg-surface-muted px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">From</p>
        <p className="truncate text-sm font-medium text-ink">
          {collectionLabels[endpoints.fromCollection] ?? endpoints.fromCollection}
        </p>
        <p className="truncate font-mono text-xs text-accent-blue">{endpoints.fromField}</p>
      </div>
      <HugeiconsIcon icon={ArrowRight02Icon} className="h-4 w-4 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1 text-right">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">To</p>
        <p className="truncate text-sm font-medium text-ink">
          {collectionLabels[endpoints.toCollection] ?? endpoints.toCollection}
        </p>
        <p className="truncate font-mono text-xs text-accent-blue">{endpoints.toField}</p>
      </div>
    </div>
  );
}

export function RelationDialog({ state, onClose, collectionLabels }: RelationDialogProps) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<RelationType>("one-to-many");
  const [description, setDescription] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.mode === "edit") {
      setType(state.relation.type);
      setDescription(state.relation.description ?? "");
    } else {
      setType("one-to-many");
      setDescription("");
    }
    setDeleteArmed(false);
    setError(null);
  }, [state]);

  const invalidateRelations = () => {
    void queryClient.invalidateQueries({ queryKey: ["relations"] });
  };

  const createMutation = useMutation({
    mutationFn: createRelation,
    onSuccess: () => {
      invalidateRelations();
      onClose();
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRelationInput }) =>
      updateRelation(id, input),
    onSuccess: () => {
      invalidateRelations();
      onClose();
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRelation,
    onSuccess: () => {
      invalidateRelations();
      onClose();
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const isPending =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  if (!state) {
    return null;
  }

  const isEdit = state.mode === "edit";
  const endpoints: RelationEndpoints = isEdit ? state.relation : state.draft;

  const handleSave = () => {
    setError(null);
    if (isEdit) {
      updateMutation.mutate({
        id: state.relation._id,
        input: { type, description: description.trim() },
      });
    } else {
      createMutation.mutate({
        ...state.draft,
        type,
        description: description.trim() || undefined,
      });
    }
  };

  const handleDelete = () => {
    if (!isEdit) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setError(null);
    deleteMutation.mutate(state.relation._id);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit relation" : "Create relation"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Change the relation type or description, or remove the relation."
              : "Confirm how these two fields relate to each other."}
          </DialogDescription>
        </DialogHeader>

        <EndpointSummary endpoints={endpoints} collectionLabels={collectionLabels} />

        <div className="grid gap-2">
          <Label htmlFor="relation-type">Relation type</Label>
          <Select value={type} onValueChange={(value) => setType(value as RelationType)}>
            <SelectTrigger id="relation-type">
              <SelectValue placeholder="Select a type" />
            </SelectTrigger>
            <SelectContent>
              {RELATION_TYPES.map((relationType) => (
                <SelectItem key={relationType} value={relationType}>
                  {RELATION_TYPE_NAMES[relationType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="relation-description">
            Description <span className="font-normal text-ink-muted">(optional)</span>
          </Label>
          <Input
            id="relation-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Each order belongs to one customer"
            maxLength={300}
          />
        </div>

        {error && (
          <p className="animate-fade-in rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </p>
        )}

        <DialogFooter className={cn(isEdit && "sm:justify-between")}>
          {isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className={cn(
                "border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700",
                deleteArmed && "border-rose-500 bg-rose-50 font-semibold",
              )}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
              {deleteMutation.isPending
                ? "Deleting…"
                : deleteArmed
                  ? "Click again to confirm"
                  : "Delete"}
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {isEdit
                ? updateMutation.isPending
                  ? "Saving…"
                  : "Save changes"
                : createMutation.isPending
                  ? "Creating…"
                  : "Create relation"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
