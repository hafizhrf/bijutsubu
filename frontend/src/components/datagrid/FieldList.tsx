import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { cn } from "@/lib/utils";
import { addField, deleteField, updateCollectionMeta, updateField } from "@/api/collections";
import type {
  CollectionField,
  FieldPatchInput,
  FieldType,
  MetaCollection,
} from "@/types/collections";
import { FIELD_TYPES } from "@/types/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Key01Icon,
  Loading03Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

const FIELD_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ \-/()]{0,63}$/;

export function fieldTypeDotClass(type: string): string {
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

function fieldErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ error?: string }>(error)) {
    const code = error.response?.data?.error;
    if (code === "field_already_exists" || error.response?.status === 409) {
      return "A field with that name already exists.";
    }
    if (code === "invalid_input") {
      return "That field name is not allowed.";
    }
  }
  return fallback;
}

/** True when `type` is one of the editable FieldType values (LLM imports may produce others). */
function isKnownFieldType(type: string): type is FieldType {
  return (FIELD_TYPES as string[]).includes(type);
}

interface FieldListProps {
  collection: MetaCollection;
}

/**
 * Compact per-collection field list shown under a collection in the sidebar
 * rail. Click a field to edit name/type/nullable or delete it.
 */
export function FieldList({ collection }: FieldListProps) {
  const queryClient = useQueryClient();
  const [editTarget, setEditTarget] = useState<CollectionField | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<FieldType>("string");
  const [editNullable, setEditNullable] = useState(true);
  const [editUnique, setEditUnique] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionField | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<FieldType>("string");
  const [formError, setFormError] = useState<string | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["collections"], exact: true });
    void queryClient.invalidateQueries({
      queryKey: ["collections", collection.name, "rows"],
    });
  }

  const patchMutation = useMutation({
    mutationFn: async ({
      field,
      patch,
      uniquePatch,
    }: {
      field: string;
      patch: FieldPatchInput | null;
      uniquePatch: string | null | undefined;
    }) => {
      if (patch) await updateField(collection.name, field, patch);
      if (uniquePatch !== undefined) {
        await updateCollectionMeta(collection.name, { upsertKey: uniquePatch });
      }
    },
    onSuccess: () => {
      invalidate();
      setEditTarget(null);
    },
    onError: (error) => setFormError(fieldErrorMessage(error, "Could not update the field.")),
  });

  const addMutation = useMutation({
    mutationFn: () => addField(collection.name, { name: addName.trim(), type: addType }),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
    },
    onError: (error) => setFormError(fieldErrorMessage(error, "Could not add the field.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (field: string) => deleteField(collection.name, field),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
    },
    onError: (error) => setFormError(fieldErrorMessage(error, "Could not delete the field.")),
  });

  function openEditor(field: CollectionField) {
    setFormError(null);
    setEditName(field.name);
    setEditType(isKnownFieldType(field.type) ? field.type : "string");
    setEditNullable(field.nullable !== false);
    setEditUnique(collection.upsertKey === field.name);
    setEditTarget(field);
  }

  function submitEdit() {
    if (!editTarget) return;
    const trimmedName = editName.trim();
    if (!FIELD_NAME_RE.test(trimmedName)) {
      setFormError(
        "Use letters, numbers, spaces, _ - / ( ) — up to 64 characters, not starting with a symbol.",
      );
      return;
    }

    const patch: FieldPatchInput = {};
    if (trimmedName !== editTarget.name) patch.newName = trimmedName;
    if (editType !== editTarget.type) patch.type = editType;
    if (editNullable !== (editTarget.nullable !== false)) patch.nullable = editNullable;

    const wasUnique = collection.upsertKey === editTarget.name;
    // upsertKey follows renames server-side, so only send it when toggled.
    const uniquePatch: string | null | undefined =
      editUnique === wasUnique ? undefined : editUnique ? trimmedName : null;

    if (Object.keys(patch).length === 0 && uniquePatch === undefined) {
      setEditTarget(null);
      return;
    }
    setFormError(null);
    patchMutation.mutate({
      field: editTarget.name,
      patch: Object.keys(patch).length > 0 ? patch : null,
      uniquePatch,
    });
  }

  function submitAdd() {
    const trimmed = addName.trim();
    if (!FIELD_NAME_RE.test(trimmed)) {
      setFormError(
        "Use letters, numbers, spaces, _ - / ( ) — up to 64 characters, not starting with a symbol.",
      );
      return;
    }
    addMutation.mutate();
  }

  return (
    <div className="ml-4 mt-0.5 flex animate-fade-in flex-col gap-1 border-l border-border-soft py-1.5 pl-2">
      {collection.fields.map((field) => (
        <button
          key={field.name}
          type="button"
          onClick={() => openEditor(field)}
          title={`Edit ${field.name} (${field.type}${field.nullable ? ", nullable" : ""})`}
          className="group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50"
        >
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fieldTypeDotClass(field.type))}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
            {field.name}
          </span>
          {collection.upsertKey === field.name && (
            <HugeiconsIcon icon={Key01Icon}
              className="h-3 w-3 shrink-0 text-amber-500"
              aria-label="Unique field"
            />
          )}
          <span className="shrink-0 text-[10px] text-ink-muted">
            {field.type}
            {field.nullable ? "?" : ""}
          </span>
          <HugeiconsIcon icon={PencilEdit02Icon} className="h-3 w-3 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}

      <button
        type="button"
        onClick={() => {
          setFormError(null);
          setAddName("");
          setAddType("string");
          setAddOpen(true);
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50"
      >
        <HugeiconsIcon icon={PlusSignIcon} className="h-3 w-3 shrink-0" /> Add field
      </button>

      {/* Edit field dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit field</DialogTitle>
            <DialogDescription>
              Changes to <span className="font-medium text-ink">{editTarget?.name}</span> apply to
              every row in <span className="font-medium text-ink">{collection.displayName}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-field-name">Name</Label>
              <Input
                id="edit-field-name"
                autoFocus
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitEdit();
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <Select value={editType} onValueChange={(value) => setEditType(value as FieldType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="capitalize">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={editNullable}
                onChange={(event) => setEditNullable(event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-accent-blue"
              />
              Nullable
            </label>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={editUnique}
                  onChange={(event) => setEditUnique(event.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-accent-blue"
                />
                Unique field
              </label>
              <p className="pl-5 text-xs text-ink-muted">
                {editUnique &&
                collection.upsertKey &&
                collection.upsertKey !== editTarget?.name
                  ? `Replaces the current unique field (${collection.upsertKey}).`
                  : "Uploads use this field to detect duplicate rows (skip or update them)."}
              </p>
            </div>
            {formError && <p className="animate-fade-in text-xs text-rose-600">{formError}</p>}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-rose-600 hover:bg-rose-50 hover:text-rose-600"
              onClick={() => {
                if (!editTarget) return;
                setFormError(null);
                setDeleteTarget(editTarget);
                setEditTarget(null);
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" /> Delete
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button onClick={submitEdit} disabled={!editName.trim() || patchMutation.isPending}>
                {patchMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add field dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Add field</DialogTitle>
            <DialogDescription>
              The new field is set to null on all existing rows of{" "}
              <span className="font-medium text-ink">{collection.displayName}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-field-name">Name</Label>
              <Input
                id="add-field-name"
                autoFocus
                placeholder="e.g. status"
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitAdd();
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <Select value={addType} onValueChange={(value) => setAddType(value as FieldType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="capitalize">
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError && <p className="animate-fade-in text-xs text-rose-600">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={!addName.trim() || addMutation.isPending}>
              {addMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Add field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete field dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete field</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium text-ink">{deleteTarget?.name}</span> and
              its data from every row in this collection. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {formError && <p className="animate-fade-in text-xs text-rose-600">{formError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.name)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />}
              Delete field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
