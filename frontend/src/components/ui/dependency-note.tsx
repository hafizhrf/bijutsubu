import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";

/**
 * Amber callout used inside delete-confirmation dialogs to spell out what the
 * deletion affects (relations, referencing rows, dashboards).
 */
export function DependencyNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-left">
      <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 text-xs text-amber-800">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 flex flex-col gap-1">{children}</div>
      </div>
    </div>
  );
}
