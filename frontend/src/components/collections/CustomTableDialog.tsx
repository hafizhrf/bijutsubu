import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { queryCustomTable, saveCustomTable } from "@/api/collections";
import type { CustomTableResult } from "@/api/collections";
import { Button } from "@/components/ui/button";
import { CollectionMentionInput } from "@/components/prompt/CollectionMentionInput";
import {
  CustomTableResultView,
  slugify,
} from "@/components/collections/CustomTableResultView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Bookmark01Icon,
  InformationCircleIcon,
  Loading03Icon,
  MagicWand01Icon,
  Table01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

function requestErrorMessage(error: unknown): string {
  if (isAxiosError<{ rejected?: boolean; reason?: string; retryAfterMs?: number }>(error)) {
    const data = error.response?.data;
    if (data?.rejected && data.reason) return data.reason;
    if (error.response?.status === 429) {
      const seconds = Math.ceil((data?.retryAfterMs ?? 60_000) / 1000);
      return `You're generating too fast — try again in about ${seconds}s.`;
    }
  }
  return "Could not build that table. Please try rephrasing your prompt.";
}

/**
 * "Custom table" — prompt-driven, read-only table over the user's collections,
 * launched from the button next to the Collections/Relations tabs. Results get
 * client-side search, pagination, CSV download, and can be saved for reuse
 * (the DSL is persisted server-side and re-executed live on open).
 */
export function CustomTableDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<CustomTableResult | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const queryMutation = useMutation({
    mutationFn: queryCustomTable,
    onSuccess: (data, usedPrompt) => {
      setResult(data);
      setLastPrompt(usedPrompt);
      setSaveOpen(false);
      saveMutation.reset();
    },
  });

  const saveMutation = useMutation({
    mutationFn: saveCustomTable,
    onSuccess: () => {
      setSaveOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["custom-tables"] });
    },
  });

  function run() {
    const trimmed = prompt.trim();
    if (!trimmed || queryMutation.isPending) return;
    queryMutation.mutate(trimmed);
  }

  function handleSave() {
    if (!result || saveMutation.isPending) return;
    const name = saveName.trim() || result.title;
    saveMutation.mutate({
      name,
      prompt: lastPrompt,
      title: result.title,
      columns: result.columns,
      query: result.query,
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Table01Icon} className="h-3.5 w-3.5" /> Custom table
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full max-w-[min(64rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Custom table</DialogTitle>
            <DialogDescription>
              Describe the data you want to see and it becomes a read-only table. Type{" "}
              <span className="font-mono text-xs text-ink">{"{"}</span> to reference one of your
              collections.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <CollectionMentionInput
              multiline
              autoFocus
              value={prompt}
              onValueChange={setPrompt}
              onSubmit={run}
              disabled={queryMutation.isPending}
              placeholder={'e.g. "top 20 rows of {products} by price" or "count rows in {products} per category" — Ctrl+Enter to run'}
              className="min-h-20"
            />
            <Button onClick={run} disabled={!prompt.trim() || queryMutation.isPending} className="w-full">
              {queryMutation.isPending ? (
                <HugeiconsIcon icon={Loading03Icon} className="h-4 w-4 animate-spin" />
              ) : (
                <HugeiconsIcon icon={MagicWand01Icon} className="h-4 w-4" />
              )}
              {queryMutation.isPending ? "Building…" : "Run"}
            </Button>

            {queryMutation.isError && (
              <div className="flex animate-fade-in items-start gap-2 rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-muted">
                <HugeiconsIcon icon={InformationCircleIcon} className="mt-0.5 h-4 w-4 shrink-0 text-accent-blue" />
                <span>{requestErrorMessage(queryMutation.error)}</span>
              </div>
            )}

            {result && !queryMutation.isError && (
              <>
                <CustomTableResultView
                  title={result.title}
                  columns={result.columns}
                  rows={result.rows}
                  actions={
                    saveMutation.isSuccess ? (
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-100 px-3 text-xs font-semibold text-emerald-700">
                        <HugeiconsIcon icon={Tick02Icon} className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          setSaveName(slugify(result.title).replace(/-/g, " ") || result.title);
                          setSaveOpen((prev) => !prev);
                        }}
                        title="Save this table for reuse — it re-runs on current data every time you open it"
                      >
                        <HugeiconsIcon icon={Bookmark01Icon} className="h-3.5 w-3.5" /> Save
                      </Button>
                    )
                  }
                />

                {saveOpen && !saveMutation.isSuccess && (
                  <div className="flex animate-fade-in items-center gap-2 rounded-2xl border border-border-soft bg-surface-muted/40 px-3 py-2.5">
                    <input
                      value={saveName}
                      onChange={(event) => setSaveName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleSave();
                      }}
                      placeholder="Name this table…"
                      aria-label="Saved table name"
                      autoFocus
                      className="h-8 min-w-0 flex-1 rounded-full border border-border-soft bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus-visible:border-accent-blue/40 focus-visible:ring-2 focus-visible:ring-accent-blue/50"
                    />
                    <Button size="sm" className="h-8" onClick={handleSave} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? (
                        <HugeiconsIcon icon={Loading03Icon} className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HugeiconsIcon icon={Bookmark01Icon} className="h-3.5 w-3.5" />
                      )}
                      Save table
                    </Button>
                  </div>
                )}
                {saveMutation.isError && (
                  <p className="text-xs text-rose-600">
                    Could not save this table. Try again in a moment.
                  </p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
