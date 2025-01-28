import { z } from 'zod';

// Input schemas
export const TimeRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional()
});

export const CommitRangeSchema = z.object({
  fromCommit: z.string().optional(),
  toCommit: z.string().optional()
});

export const FormatOptionsSchema = z.object({
  type: z.enum(['markdown', 'json', 'text']).default('markdown'),
  groupBy: z.enum(['type', 'author', 'scope']).default('type'),
  includeStats: z.boolean().default(false),
  template: z.string().optional()
});

export const GenerateNotesSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  timeRange: TimeRangeSchema.optional(),
  commitRange: CommitRangeSchema.optional(),
  format: FormatOptionsSchema.default({})
});

export const AnalyzeCommitsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  timeRange: TimeRangeSchema.optional(),
  commitRange: CommitRangeSchema.optional()
});

export const ConfigureTemplateSchema = z.object({
  name: z.string(),
  template: z.string()
});

// Types
export type CommitType = 
  | 'breaking'
  | 'feature'
  | 'fix'
  | 'docs'
  | 'perf'
  | 'refactor'
  | 'test'
  | 'build'
  | 'other';

export interface ParsedCommit {
  sha: string;
  type: CommitType;
  scope?: string;
  message: string;
  description?: string;
  breaking: boolean;
  author: string;
  date: string;
  prNumber?: number;
  commitUrl: string;
}

export interface CommitStats {
  totalCommits: number;
  commitsByType: Record<CommitType, number>;
  commitsByAuthor: Record<string, number>;
  commitsByScope: Record<string, number>;
  breakingChanges: number;
}

export interface ReleaseNotes {
  version?: string;
  date: string;
  breakingChanges: ParsedCommit[];
  commits: ParsedCommit[];
  stats?: CommitStats;
}
