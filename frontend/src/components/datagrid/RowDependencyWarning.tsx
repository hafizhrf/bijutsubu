import { useQuery } from "@tanstack/react-query";
import { getRowDependencies } from "@/api/collections";
import { DependencyNote } from "@/components/ui/dependency-note";

interface RowDependencyWarningProps {
  collectionName: string;
  ids: string[];
  /** Query only while the confirm dialog is actually open. */
  enabled: boolean;
}

/**
 * Warns, inside a delete-rows confirmation, when rows in OTHER collections
 * reference the rows being deleted through a relation — deleting would leave
 * those references dangling.
 */
export function RowDependencyWarning({ collectionName, ids, enabled }: RowDependencyWarningProps) {
  const depsQuery = useQuery({
    queryKey: ["collections", collectionName, "row-deps", [...ids].sort().join(",")],
    queryFn: () => getRowDependencies(collectionName, ids),
    enabled: enabled && ids.length > 0,
    staleTime: 0,
  });

  const dependents = depsQuery.data?.dependents ?? [];
  if (dependents.length === 0) return null;

  return (
    <DependencyNote title="Other rows reference what you're deleting">
      {dependents.map((dependent) => (
        <p key={`${dependent.collection}.${dependent.field}`}>
          <span className="font-medium">{dependent.count.toLocaleString()}</span> row
          {dependent.count === 1 ? "" : "s"} in{" "}
          <span className="font-medium">{dependent.displayName}</span> point here via{" "}
          <span className="font-mono text-[10px]">{dependent.field}</span> ({dependent.type}) —
          those references will be left broken.
        </p>
      ))}
    </DependencyNote>
  );
}
