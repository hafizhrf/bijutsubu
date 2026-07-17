import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { RELATION_TYPE_LABELS } from "./types";
import type { RelationFlowEdge } from "./types";

export const RelationEdge = memo(function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<RelationFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const relation = data?.relation;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: "#5b7cfa",
          strokeWidth: selected ? 2.5 : 1.5,
          opacity: selected ? 1 : 0.8,
        }}
      />
      {relation && (
        <EdgeLabelRenderer>
          {/* pointer-events: none lets clicks fall through to the edge's
              interaction path, so onEdgeClick handles label clicks too. */}
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <span
              className={cn(
                "inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm transition-colors",
                selected
                  ? "border-accent-blue bg-accent-blue text-white"
                  : "border-border-soft bg-surface text-accent-blue",
              )}
            >
              {RELATION_TYPE_LABELS[relation.type]}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
