import type { Edge, Node } from "@xyflow/react";
import type { MetaCollection, MetaRelation, RelationType } from "@/types/collections";

export interface CollectionNodeData extends Record<string, unknown> {
  collection: MetaCollection;
  /** Field names participating in at least one relation — always kept visible. */
  connectedFields: string[];
}

export type CollectionFlowNode = Node<CollectionNodeData, "collection">;

export interface RelationEdgeData extends Record<string, unknown> {
  relation: MetaRelation;
}

export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  "one-to-one": "1:1",
  "one-to-many": "1:N",
  "many-to-many": "N:M",
};

export const RELATION_TYPE_NAMES: Record<RelationType, string> = {
  "one-to-one": "One to one (1:1)",
  "one-to-many": "One to many (1:N)",
  "many-to-many": "Many to many (N:M)",
};

/** Shape shared by a fresh drag-connection and an existing relation. */
export interface RelationEndpoints {
  fromCollection: string;
  toCollection: string;
  fromField: string;
  toField: string;
}
