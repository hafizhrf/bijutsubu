import { api } from "@/lib/api";
import type { MetaRelation, RelationType } from "@/types/collections";

export interface CreateRelationInput {
  fromCollection: string;
  toCollection: string;
  fromField: string;
  toField: string;
  type: RelationType;
  description?: string;
}

export interface UpdateRelationInput {
  fromField?: string;
  toField?: string;
  type?: RelationType;
  description?: string;
}

export async function createRelation(input: CreateRelationInput): Promise<MetaRelation> {
  const { data } = await api.post<{ relation: MetaRelation }>("/collections/relations", input);
  return data.relation;
}

export async function updateRelation(
  id: string,
  input: UpdateRelationInput,
): Promise<MetaRelation> {
  const { data } = await api.patch<{ relation: MetaRelation }>(
    `/collections/relations/${encodeURIComponent(id)}`,
    input,
  );
  return data.relation;
}

export async function deleteRelation(id: string): Promise<void> {
  await api.delete<{ ok: boolean }>(`/collections/relations/${encodeURIComponent(id)}`);
}
