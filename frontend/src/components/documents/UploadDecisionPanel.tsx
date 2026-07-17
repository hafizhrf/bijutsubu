import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ApplyDecision,
  DuplicateStrategy,
  UploadFieldOverride,
  UploadPreviewCandidate,
} from "@/types/collections";
import type { PendingDecision } from "@/store/uploadQueueStore";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadPreviewDialog } from "@/components/documents/UploadPreviewDialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight02Icon,
  Clock01Icon,
  Database01Icon,
  EyeIcon,
  GitMergeIcon,
  InformationCircleIcon,
  Key01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

/** Mirrors the backend's FIELD_NAME_PATTERN (schemas/fieldCommon.ts). */
const FIELD_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ \-/()]{0,63}$/;
const FIELD_TYPES = ["string", "number", "boolean", "date", "array", "object"] as const;

/** Option keys: "apply-plan", "create-new", or "merge:<collectionName>". */
type OptionKey = string;

interface UploadDecisionPanelProps {
  fileName: string;
  pending: PendingDecision;
  errorMessage: string | null;
  now: number;
  onResolve: (decision: ApplyDecision) => void;
  onSkip: () => void;
}

function candidateSummary(candidate: UploadPreviewCandidate): string {
  const parts = [`${candidate.matchedFields.length} matched fields`];
  if (candidate.newFields.length > 0) parts.push(`${candidate.newFields.length} new`);
  if (candidate.missingRequiredFields.length > 0) {
    parts.push(`${candidate.missingRequiredFields.length} required missing`);
  }
  if (candidate.duplicates && candidate.duplicates.count > 0) {
    parts.push(`${candidate.duplicates.count} duplicates`);
  }
  return parts.join(" · ");
}

/**
 * Interactive replacement for the old passive "similar data detected" note:
 * the file is parsed and planned but NOT written yet — the user chooses to
 * merge into a similar collection (skipping or updating duplicates), proceed
 * as the LLM planned, create a fresh collection, or skip the file entirely.
 */
/**
 * All-or-nothing approval for a staged SQL dump: a summary of every
 * collection (with row/field counts) and every relation the import will
 * create. No merge/field-edit options — approve exactly what's listed, or skip.
 */
function SqlDumpApproval({
  pending,
  errorMessage,
  now,
  onResolve,
  onSkip,
}: Omit<UploadDecisionPanelProps, "fileName">) {
  const summary = pending.sqlSummary!;
  const expiresInMin = Math.max(0, Math.ceil((new Date(pending.expiresAt).getTime() - now) / 60_000));
  const totalRows = summary.tables.reduce((sum, table) => sum + table.rowCount, 0);
  const collisions = summary.tables.filter((table) => table.exists);
  const [strategy, setStrategy] = useState<"replace" | "suffix">("replace");

  return (
    <div className="mt-3 flex animate-fade-in-up flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 dark:border-amber-300/20 dark:bg-amber-400/10 p-4">
      <div className="flex gap-3 text-amber-900 dark:text-amber-200">
        <HugeiconsIcon icon={InformationCircleIcon} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            SQL import ready — {summary.tables.length} collection{summary.tables.length === 1 ? "" : "s"}, {totalRows.toLocaleString()} rows
            {summary.relations.length > 0 && `, ${summary.relations.length} relation${summary.relations.length === 1 ? "" : "s"}`}
          </p>
          <p className="flex items-center gap-1 text-xs text-amber-800/80 dark:text-amber-200/70">
            <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" /> Nothing is saved yet · review the summary and approve · expires in ~{expiresInMin} min
          </p>
        </div>
      </div>

      {errorMessage && (
        <p className="flex items-start gap-1.5 rounded-xl bg-rose-100/70 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {summary.tables.map((table) => (
          <div key={table.collectionName} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-soft bg-surface/70 px-3 py-2">
            <HugeiconsIcon icon={Database01Icon} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="text-sm font-medium text-ink">{table.displayName}</span>
            {table.collectionName !== table.displayName && (
              <span className="font-mono text-[11px] text-ink-muted">→ {table.collectionName}</span>
            )}
            <span className="text-xs text-ink-muted">
              {table.rowCount.toLocaleString()} rows · {table.fields.length} fields
            </span>
            {table.exists && (
              <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">
                {strategy === "replace"
                  ? table.updatableByKey
                    ? "exists — will update"
                    : "exists, no key — will copy"
                  : "exists — will copy"}
              </span>
            )}
            <span className="flex min-w-0 flex-wrap gap-1">
              {table.fields.slice(0, 5).map((field) => (
                <span key={field.name} className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                  {field.name}
                </span>
              ))}
              {table.fields.length > 5 && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-ink-muted">
                  +{table.fields.length - 5}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {summary.relations.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <HugeiconsIcon icon={GitMergeIcon} className="h-3 w-3" /> Relations from foreign keys
          </p>
          <div className="flex flex-col gap-1">
            {summary.relations.map((relation, index) => (
              <span key={index} className="flex flex-wrap items-center gap-1.5 pl-4.5 font-mono text-[11px] text-ink-muted">
                {relation.fromCollection}.{relation.fromField}
                <HugeiconsIcon icon={ArrowRight02Icon} className="h-3 w-3" />
                {relation.toCollection}.{relation.toField}
              </span>
            ))}
          </div>
        </div>
      )}

      {collisions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <HugeiconsIcon icon={Alert02Icon} className="h-3 w-3" /> {collisions.length} collection
            {collisions.length === 1 ? "" : "s"} already exist{collisions.length === 1 ? "s" : ""} — choose what to do
          </p>
          <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-border-soft bg-surface/70 px-3 py-2">
            <input
              type="radio"
              name={`sql-strategy-${pending.pendingId}`}
              checked={strategy === "replace"}
              onChange={() => setStrategy("replace")}
              className="mt-0.5 h-3.5 w-3.5 accent-accent-blue"
            />
            <span className="flex flex-col text-xs">
              <span className="text-sm font-medium text-ink">Update existing collections</span>
              <span className="text-ink-muted">
                Rows are matched by primary key — same keys are overwritten, new keys added. Tables
                without a key are imported as copies.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-2xl border border-border-soft bg-surface/70 px-3 py-2">
            <input
              type="radio"
              name={`sql-strategy-${pending.pendingId}`}
              checked={strategy === "suffix"}
              onChange={() => setStrategy("suffix")}
              className="mt-0.5 h-3.5 w-3.5 accent-accent-blue"
            />
            <span className="flex flex-col text-xs">
              <span className="text-sm font-medium text-ink">Keep existing — import as new copies</span>
              <span className="text-ink-muted">Colliding tables get a numbered name like pesanan_2.</span>
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip this file
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onResolve({
              mode: "apply-plan",
              ...(collisions.length > 0 ? { sqlCollisionStrategy: strategy } : {}),
            })
          }
        >
          Approve &amp; import everything
        </Button>
      </div>
    </div>
  );
}

export function UploadDecisionPanel(props: UploadDecisionPanelProps) {
  // SQL dumps get the dedicated multi-collection approval; hook-free wrapper
  // so each branch keeps a stable hook order.
  if (props.pending.sqlSummary) return <SqlDumpApproval {...props} />;
  return <SingleUploadDecision {...props} />;
}

function SingleUploadDecision({
  fileName,
  pending,
  errorMessage,
  now,
  onResolve,
  onSkip,
}: UploadDecisionPanelProps) {
  const { plan, preview } = pending;
  const hasPlannedTarget = plan.action !== "create";

  const [selected, setSelected] = useState<OptionKey>(
    hasPlannedTarget ? "apply-plan" : "create-new",
  );
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("skip");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editFieldsOpen, setEditFieldsOpen] = useState(false);
  // Keyed by the plan's original field name; only present once the user touches a field.
  const [fieldEdits, setFieldEdits] = useState<Record<string, { name: string; type: string }>>({});

  // Merging must conform to the target's existing schema — editing only
  // applies to the create-flavored choices.
  const createFlavored = selected === "apply-plan" || selected === "create-new";

  const fieldOverrides = useMemo<UploadFieldOverride[]>(
    () =>
      plan.fields.flatMap((field) => {
        const edit = fieldEdits[field.name];
        if (!edit || (edit.name === field.name && edit.type === field.type)) return [];
        return [{ originalName: field.name, name: edit.name.trim(), type: edit.type }];
      }),
    [plan.fields, fieldEdits],
  );

  const fieldEditError = useMemo(() => {
    if (fieldOverrides.length === 0) return null;
    for (const override of fieldOverrides) {
      if (!FIELD_NAME_RE.test(override.name)) {
        return `"${override.name || override.originalName}" is not a valid field name.`;
      }
    }
    const resulting = plan.fields.map(
      (field) => fieldOverrides.find((o) => o.originalName === field.name)?.name ?? field.name,
    );
    if (new Set(resulting).size !== resulting.length) {
      return "Two fields would end up with the same name.";
    }
    return null;
  }, [plan.fields, fieldOverrides]);

  const selectedCandidate = useMemo(
    () =>
      selected.startsWith("merge:")
        ? (preview.candidates.find((c) => c.collectionName === selected.slice(6)) ?? null)
        : null,
    [selected, preview.candidates],
  );

  const expiresInMs = new Date(pending.expiresAt).getTime() - now;
  const expiresInMin = Math.max(0, Math.ceil(expiresInMs / 60_000));

  function apply() {
    if (createFlavored && fieldEditError) return;
    const overrides =
      createFlavored && fieldOverrides.length > 0 ? { fieldOverrides } : {};
    if (selected === "apply-plan") {
      onResolve({ mode: "apply-plan", ...overrides });
    } else if (selected === "create-new") {
      onResolve({ mode: "create-new", ...overrides });
    } else if (selectedCandidate) {
      onResolve({
        mode: "merge-into",
        targetCollection: selectedCandidate.collectionName,
        duplicateStrategy: selectedCandidate.uniqueField ? duplicateStrategy : "skip",
      });
    }
  }

  const optionBase =
    "flex cursor-pointer flex-col gap-1 rounded-2xl border p-3 transition-colors";

  return (
    <div className="mt-3 flex animate-fade-in-up flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 dark:border-amber-300/20 dark:bg-amber-400/10 p-4">
      <div className="flex gap-3 text-amber-900 dark:text-amber-200">
        <HugeiconsIcon icon={InformationCircleIcon} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {hasPlannedTarget || preview.candidates.length > 0
              ? "Similar data detected — choose what to do"
              : `Review upload — approve to create "${plan.displayName}" (${preview.totalRows.toLocaleString()} rows)`}
          </p>
          {pending.similarityNote && <p>{pending.similarityNote}</p>}
          <p className="flex items-center gap-1 text-xs text-amber-800/80 dark:text-amber-200/70">
            <HugeiconsIcon icon={Clock01Icon} className="h-3 w-3" /> Nothing is saved yet · this choice expires in ~
            {expiresInMin} min, then the file is re-analyzed
          </p>
        </div>
      </div>

      {errorMessage && (
        <p className="flex items-start gap-1.5 rounded-xl bg-rose-100/70 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {hasPlannedTarget && (
          <label
            className={cn(
              optionBase,
              selected === "apply-plan"
                ? "border-accent-blue bg-surface shadow-sm"
                : "border-border-soft bg-surface/60 hover:bg-surface",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="radio"
                name={`decision-${pending.pendingId}`}
                checked={selected === "apply-plan"}
                onChange={() => setSelected("apply-plan")}
                className="h-3.5 w-3.5 accent-accent-blue"
              />
              Proceed as planned — <span className="capitalize">{plan.action}</span> into{" "}
              {plan.displayName}
            </span>
            <span className="pl-5.5 text-xs text-ink-muted">
              Follows your instruction exactly as the planner understood it.
            </span>
          </label>
        )}

        {preview.candidates.map((candidate) => {
          const key = `merge:${candidate.collectionName}`;
          const isSelected = selected === key;
          return (
            <label
              key={key}
              className={cn(
                optionBase,
                isSelected
                  ? "border-accent-blue bg-surface shadow-sm"
                  : "border-border-soft bg-surface/60 hover:bg-surface",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="radio"
                  name={`decision-${pending.pendingId}`}
                  checked={isSelected}
                  onChange={() => setSelected(key)}
                  className="h-3.5 w-3.5 accent-accent-blue"
                />
                <HugeiconsIcon icon={GitMergeIcon} className="h-3.5 w-3.5 text-ink-muted" />
                Merge into {candidate.displayName}
              </span>
              <span className="pl-5.5 text-xs text-ink-muted">
                {candidateSummary(candidate)}
              </span>
              {isSelected &&
                (candidate.uniqueField ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-5.5">
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                      <HugeiconsIcon icon={Key01Icon} className="h-3 w-3 text-amber-500" /> Duplicates on{" "}
                      <span className="font-mono">{candidate.uniqueField}</span>:
                    </span>
                    <Select
                      value={duplicateStrategy}
                      onValueChange={(value) => setDuplicateStrategy(value as DuplicateStrategy)}
                    >
                      <SelectTrigger className="h-8 w-56 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip — keep existing rows</SelectItem>
                        <SelectItem value="overwrite">Update — overwrite with new data</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="pl-5.5 text-xs text-amber-700 dark:text-amber-300">
                    No unique field set on this collection — every row will be appended. Set one
                    on the Collections page to skip/update duplicates.
                  </span>
                ))}
            </label>
          );
        })}

        <label
          className={cn(
            optionBase,
            selected === "create-new"
              ? "border-accent-blue bg-surface shadow-sm"
              : "border-border-soft bg-surface/60 hover:bg-surface",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="radio"
              name={`decision-${pending.pendingId}`}
              checked={selected === "create-new"}
              onChange={() => setSelected("create-new")}
              className="h-3.5 w-3.5 accent-accent-blue"
            />
            <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5 text-ink-muted" />
            Create as new collection "{plan.displayName}"
          </span>
          <span className="pl-5.5 text-xs text-ink-muted">
            Keeps existing collections untouched.
          </span>
        </label>
      </div>

      {createFlavored && plan.relations.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <HugeiconsIcon icon={GitMergeIcon} className="h-3 w-3" /> Relations that will be added
          </p>
          {plan.relations.map((relation, index) => (
            <span key={index} className="flex flex-wrap items-center gap-1.5 pl-4.5 font-mono text-[11px] text-ink-muted">
              {plan.displayName}.{relation.fromField}
              <HugeiconsIcon icon={ArrowRight02Icon} className="h-3 w-3" />
              {relation.toCollection}.{relation.toField}
            </span>
          ))}
        </div>
      )}

      {createFlavored && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setEditFieldsOpen((open) => !open)}
            className="flex w-fit items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 underline-offset-2 transition-colors hover:underline"
          >
            <HugeiconsIcon icon={PencilEdit02Icon} className="h-3 w-3" />
            {editFieldsOpen ? "Hide field editing" : "Edit field names & types before saving"}
            {fieldOverrides.length > 0 && ` (${fieldOverrides.length} changed)`}
          </button>

          {editFieldsOpen && (
            <div className="flex animate-fade-in flex-col gap-1.5 rounded-2xl border border-border-soft bg-surface p-3">
              {plan.fields.map((field) => {
                const edit = fieldEdits[field.name] ?? { name: field.name, type: field.type };
                const renamed = edit.name.trim() !== field.name;
                return (
                  <div key={field.name} className="flex flex-wrap items-center gap-2">
                    <input
                      value={edit.name}
                      onChange={(event) =>
                        setFieldEdits((prev) => ({
                          ...prev,
                          [field.name]: { ...edit, name: event.target.value },
                        }))
                      }
                      aria-label={`Field name for ${field.name}`}
                      className={cn(
                        "h-8 w-52 rounded-full border bg-surface px-3 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50",
                        FIELD_NAME_RE.test(edit.name.trim())
                          ? "border-border-soft focus-visible:border-accent-blue/40"
                          : "border-rose-300",
                      )}
                    />
                    <Select
                      value={edit.type}
                      onValueChange={(value) =>
                        setFieldEdits((prev) => ({
                          ...prev,
                          [field.name]: { ...edit, type: value },
                        }))
                      }
                    >
                      <SelectTrigger className="h-8 w-28 rounded-full px-3 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {renamed && (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                        renamed from <span className="font-mono">{field.name}</span>
                      </span>
                    )}
                    {!renamed && edit.type !== field.type && (
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                        was {field.type}
                      </span>
                    )}
                  </div>
                );
              })}
              {fieldEditError && (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-rose-600">
                  <HugeiconsIcon icon={Alert02Icon} className="h-3 w-3" /> {fieldEditError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip this file
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <HugeiconsIcon icon={EyeIcon} className="h-3.5 w-3.5" /> Preview details
          </Button>
          <Button size="sm" onClick={apply} disabled={createFlavored && fieldEditError !== null}>
            Apply choice
          </Button>
        </div>
      </div>

      <UploadPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        fileName={fileName}
        preview={preview}
        candidate={selectedCandidate ?? preview.candidates[0] ?? null}
      />
    </div>
  );
}
