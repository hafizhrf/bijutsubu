import { cn } from "@/lib/utils";
import type { UploadPreview, UploadPreviewCandidate } from "@/types/collections";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DataCellValue, THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Copy02Icon,
  Key01Icon,
  SearchAreaIcon,
} from "@hugeicons/core-free-icons";

interface UploadPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  preview: UploadPreview;
  /** The merge candidate currently selected in the decision panel, if any. */
  candidate: UploadPreviewCandidate | null;
}

/**
 * Interactive pre-import preview: shows how the uploaded file's fields map
 * onto the selected existing collection (matched / new / missing-required),
 * the duplicate situation on the unique field, and a sample of the incoming
 * rows — before anything is written.
 */
export function UploadPreviewDialog({
  open,
  onOpenChange,
  fileName,
  preview,
  candidate,
}: UploadPreviewDialogProps) {
  const sampleFieldNames = preview.incomingFields.map((field) => field.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(64rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Import preview</DialogTitle>
          <DialogDescription>
            {preview.totalRows.toLocaleString()} rows parsed from{" "}
            <span className="font-medium text-ink">{fileName}</span>
            {candidate && (
              <>
                {" "}
                — compared against{" "}
                <span className="font-medium text-ink">{candidate.displayName}</span>
              </>
            )}
            . Nothing is written until you apply a choice.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-5">
          {/* Field mapping */}
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <HugeiconsIcon icon={SearchAreaIcon} className="h-4 w-4 text-ink-muted" /> Field mapping
            </h3>
            <div className="overflow-hidden rounded-2xl border border-border-soft">
              <div className={cn("max-h-[30vh] overflow-auto", THIN_SCROLLBAR_CLASS)}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]">
                        Field in file
                      </th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]">
                        Type
                      </th>
                      {candidate && (
                        <th className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]">
                          Status
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {preview.incomingFields.map((field) => {
                      const isMatched = candidate?.matchedFields.includes(field.name);
                      const isNew = candidate?.newFields.includes(field.name);
                      return (
                        <tr key={field.name} className="transition-colors hover:bg-surface-muted/60">
                          <td className="px-4 py-2 text-sm font-medium text-ink">
                            <span className="inline-flex items-center gap-1.5">
                              {field.name}
                              {candidate?.uniqueField === field.name && (
                                <HugeiconsIcon icon={Key01Icon} className="h-3 w-3 text-amber-500" />
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-ink-muted">
                            {field.type}
                            {field.nullable ? "?" : ""}
                          </td>
                          {candidate && (
                            <td className="px-4 py-2">
                              {isMatched ? (
                                <Badge variant="blue">matched</Badge>
                              ) : isNew ? (
                                <Badge variant="outline">new — added as nullable</Badge>
                              ) : null}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {candidate?.missingRequiredFields.map((name) => (
                      <tr key={`missing-${name}`} className="bg-rose-50/50">
                        <td className="px-4 py-2 text-sm font-medium text-rose-700">{name}</td>
                        <td className="px-4 py-2 text-xs text-rose-600">—</td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="border-rose-300 text-rose-700">
                            required in target, missing from file
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {candidate && candidate.missingRequiredFields.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-rose-600">
                <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Merged rows will have no value for{" "}
                {candidate.missingRequiredFields.join(", ")} — those fields are marked
                non-nullable on {candidate.displayName}.
              </p>
            )}
          </section>

          {/* Duplicates */}
          {candidate && (
            <section className="flex min-w-0 flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <HugeiconsIcon icon={Copy02Icon} className="h-4 w-4 text-ink-muted" /> Duplicates
              </h3>
              {candidate.uniqueField && candidate.duplicates ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-border-soft bg-surface-muted/40 p-4 text-sm text-ink">
                  <p>
                    Checked on unique field{" "}
                    <span className="inline-flex items-center gap-1 font-mono text-xs">
                      <HugeiconsIcon icon={Key01Icon} className="h-3 w-3 text-amber-500" />
                      {candidate.uniqueField}
                    </span>
                    :
                  </p>
                  <ul className="flex flex-col gap-1 text-sm">
                    <li>
                      <span className="font-semibold">
                        {candidate.duplicates.count.toLocaleString()}
                      </span>{" "}
                      rows already exist in {candidate.displayName}
                      {candidate.duplicates.sampleValues.length > 0 && (
                        <span className="text-ink-muted">
                          {" "}
                          (e.g.{" "}
                          <span className="font-mono text-xs">
                            {candidate.duplicates.sampleValues.join(", ")}
                          </span>
                          )
                        </span>
                      )}
                    </li>
                    {candidate.duplicates.inFileDuplicateCount > 0 && (
                      <li>
                        <span className="font-semibold">
                          {candidate.duplicates.inFileDuplicateCount.toLocaleString()}
                        </span>{" "}
                        rows share a key with another row in this file
                      </li>
                    )}
                    {candidate.duplicates.rowsMissingKey > 0 && (
                      <li>
                        <span className="font-semibold">
                          {candidate.duplicates.rowsMissingKey.toLocaleString()}
                        </span>{" "}
                        rows have no value for the unique field — they are always added as-is
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border-soft bg-surface-muted/40 px-4 py-3 text-xs text-ink-muted">
                  {candidate.displayName} has no unique field set, so duplicates can't be
                  detected — merging will simply append every row. Set a unique field on the
                  Collections page to enable skip/update of duplicates.
                </p>
              )}
            </section>
          )}

          {/* Sample rows */}
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">
              Sample rows{" "}
              <span className="font-normal text-ink-muted">
                (first {preview.sampleRows.length} of {preview.totalRows.toLocaleString()})
              </span>
            </h3>
            <div className="overflow-hidden rounded-2xl border border-border-soft">
              <div className={cn("max-h-[30vh] overflow-auto", THIN_SCROLLBAR_CLASS)}>
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      {sampleFieldNames.map((name) => (
                        <th
                          key={name}
                          className="whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-soft)]"
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {preview.sampleRows.map((row, index) => (
                      <tr key={index} className="transition-colors hover:bg-surface-muted/60">
                        {sampleFieldNames.map((name) => (
                          <td key={name} className="whitespace-nowrap px-4 py-2 text-sm text-ink">
                            <DataCellValue value={row[name]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
