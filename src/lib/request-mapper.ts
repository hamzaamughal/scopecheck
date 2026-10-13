import type { RequestDto } from "@/types/request";

export type RequestRow = Omit<RequestDto, "createdAt" | "updatedAt" | "decidedAt"> & {
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
};

export function toRequestDto(row: RequestRow): RequestDto {
  return { ...row, decidedAt: row.decidedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
