import { format } from 'date-fns';
import {
  ParsedCommit,
  CommitStats,
  ReleaseNotes,
  CommitType
} from './types.js';

const EMOJI_MAP: Record<CommitType, string> = {
  breaking: '⚠️',
  feature: '🚀',
  fix: '🐛',
  docs: '📚',
  perf: '⚡',
  refactor: '♻️',
  test: '🧪',
  build: '🏗️',
  other: '🔧'
};

function calculateStats(commits: ParsedCommit[]): CommitStats {
  const stats: CommitStats = {
    totalCommits: commits.length,
    commitsByType: {
      breaking: 0,
      feature: 0,
      fix: 0,
      docs: 0,
      perf: 0,
      refactor: 0,
      test: 0,
      build: 0,
      other: 0
    },
    commitsByAuthor: {},
    commitsByScope: {},
    breakingChanges: 0
  };

  for (const commit of commits) {
    // Count by type
    stats.commitsByType[commit.type]++;
    
    // Count by author
    stats.commitsByAuthor[commit.author] = (stats.commitsByAuthor[commit.author] || 0) + 1;
    
    // Count by scope
    if (commit.scope) {
      stats.commitsByScope[commit.scope] = (stats.commitsByScope[commit.scope] || 0) + 1;
    }
    
    // Count breaking changes
    if (commit.breaking) {
      stats.breakingChanges++;
    }
  }

  return stats;
}

function groupCommitsByType(commits: ParsedCommit[]): Record<CommitType, ParsedCommit[]> {
  const grouped: Record<CommitType, ParsedCommit[]> = {
    breaking: [],
    feature: [],
    fix: [],
    docs: [],
    perf: [],
    refactor: [],
    test: [],
    build: [],
    other: []
  };

  for (const commit of commits) {
    if (commit.breaking) {
      grouped.breaking.push(commit);
    } else {
      grouped[commit.type].push(commit);
    }
  }

  return grouped;
}

function groupCommitsByScope(commits: ParsedCommit[]): Record<string, ParsedCommit[]> {
  const grouped: Record<string, ParsedCommit[]> = {};
  
  for (const commit of commits) {
    const scope = commit.scope || 'other';
    if (!grouped[scope]) {
      grouped[scope] = [];
    }
    grouped[scope].push(commit);
  }

  return grouped;
}

function groupCommitsByAuthor(commits: ParsedCommit[]): Record<string, ParsedCommit[]> {
  const grouped: Record<string, ParsedCommit[]> = {};
  
  for (const commit of commits) {
    if (!grouped[commit.author]) {
      grouped[commit.author] = [];
    }
    grouped[commit.author].push(commit);
  }

  return grouped;
}

function formatCommit(commit: ParsedCommit, includeScope = true): string {
  const emoji = EMOJI_MAP[commit.type];
  const scope = commit.scope && includeScope ? `(${commit.scope}) ` : '';
  const prLink = commit.prNumber ? ` (#${commit.prNumber})` : '';
  const breaking = commit.breaking ? ' [BREAKING]' : '';
  
  return `${emoji} ${scope}${commit.message}${breaking}${prLink}`;
}

function generateMarkdown(
  releaseNotes: ReleaseNotes,
  groupBy: 'type' | 'scope' | 'author' = 'type'
): string {
  const lines: string[] = [];
  const date = format(new Date(releaseNotes.date), 'yyyy-MM-dd');
  
  // Add header
  lines.push(`# Release Notes${releaseNotes.version ? ` (${releaseNotes.version})` : ''}`);
  lines.push(`> Generated on ${date}`);
  if (releaseNotes.stats) {
    lines.push(`> Total Commits: ${releaseNotes.stats.totalCommits} | Breaking Changes: ${releaseNotes.stats.breakingChanges}\n`);
  } else {
    lines.push('');
  }

  // Add breaking changes section if any
  if (releaseNotes.breakingChanges.length > 0) {
    lines.push('## ⚠️ Breaking Changes\n');
    for (const commit of releaseNotes.breakingChanges) {
      lines.push(`- ${formatCommit(commit)}`);
      if (commit.description) {
        lines.push(`  - ${commit.description.replace(/\n/g, '\n  - ')}`);
      }
    }
    lines.push('');
  }

  // Group commits
  let groupedCommits: Record<string, ParsedCommit[]>;
  switch (groupBy) {
    case 'type':
      groupedCommits = groupCommitsByType(releaseNotes.commits);
      break;
    case 'scope':
      groupedCommits = groupCommitsByScope(releaseNotes.commits);
      break;
    case 'author':
      groupedCommits = groupCommitsByAuthor(releaseNotes.commits);
      break;
  }

  // Add sections for each group
  for (const [group, commits] of Object.entries(groupedCommits)) {
    if (commits.length === 0) continue;
    if (group === 'breaking') continue; // Already handled above

    let sectionTitle: string;
    switch (groupBy) {
      case 'type':
        sectionTitle = `## ${EMOJI_MAP[group as CommitType]} ${group.charAt(0).toUpperCase() + group.slice(1)}`;
        break;
      case 'scope':
        sectionTitle = `## 📦 ${group}`;
        break;
      case 'author':
        sectionTitle = `## 👤 ${group}`;
        break;
    }

    lines.push(sectionTitle + '\n');
    for (const commit of commits) {
      lines.push(`- ${formatCommit(commit, groupBy !== 'scope')}`);
      if (commit.description) {
        lines.push(`  - ${commit.description.replace(/\n/g, '\n  - ')}`);
      }
    }
    lines.push('');
  }

  // Add stats if included
  if (releaseNotes.stats) {
    lines.push('## 📊 Detailed Statistics\n');
    
    lines.push('### Commits by Type');
    Object.entries(releaseNotes.stats.commitsByType)
      .filter(([, count]) => count > 0)
      .forEach(([type, count]) => {
        lines.push(`- ${EMOJI_MAP[type as CommitType]} ${type}: ${count}`);
      });
    
    if (Object.keys(releaseNotes.stats.commitsByScope).length > 0) {
      lines.push('\n### Commits by Scope');
      Object.entries(releaseNotes.stats.commitsByScope)
        .sort(([, a], [, b]) => b - a)
        .forEach(([scope, count]) => {
          lines.push(`- 📦 ${scope}: ${count}`);
        });
    }

    lines.push('\n### Commits by Author');
    Object.entries(releaseNotes.stats.commitsByAuthor)
      .sort(([, a], [, b]) => b - a)
      .forEach(([author, count]) => {
        lines.push(`- 👤 ${author}: ${count}`);
      });
  }

  return lines.join('\n');
}

function generatePlainText(
  releaseNotes: ReleaseNotes,
  groupBy: 'type' | 'scope' | 'author' = 'type'
): string {
  // Convert markdown to plain text by:
  // 1. Remove markdown headers (#)
  // 2. Remove bullet points
  // 3. Keep emojis for visual separation
  return generateMarkdown(releaseNotes, groupBy)
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s*/gm, '')
    .trim();
}

export function generateReleaseNotes(
  commits: ParsedCommit[],
  options: {
    version?: string;
    groupBy?: 'type' | 'scope' | 'author';
    format?: 'markdown' | 'json' | 'text';
    includeStats?: boolean;
    template?: string;
  } = {}
): string {
  const {
    version,
    groupBy = 'type',
    format = 'markdown',
    includeStats = false
  } = options;

  // Separate breaking changes
  const breakingChanges = commits.filter(c => c.breaking);
  const regularCommits = commits.filter(c => !c.breaking);

  const releaseNotes: ReleaseNotes = {
    version,
    date: new Date().toISOString(),
    breakingChanges,
    commits: regularCommits,
    stats: includeStats ? calculateStats(commits) : undefined
  };

  switch (format) {
    case 'markdown':
      return generateMarkdown(releaseNotes, groupBy);
    case 'json':
      return JSON.stringify(releaseNotes, null, 2);
    case 'text':
      return generatePlainText(releaseNotes, groupBy);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}
