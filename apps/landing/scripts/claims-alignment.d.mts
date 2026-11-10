export type ClaimClassification = "technical" | "historical" | "not-claim" | "claim";

export interface ClaimMatch {
  file: string;
  rule: string;
  text: string;
  classification: ClaimClassification;
}

export const locales: readonly string[];
export const root: string;
export function classifyMatch(file: string, context?: string): ClaimClassification;
export function activeFiles(): string[];
export function scanContent(file: string, content: string): ClaimMatch[];
export function scanClaims(files?: string[]): ClaimMatch[];
