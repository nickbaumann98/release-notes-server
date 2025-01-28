import axios from 'axios';
import { isAfter, isBefore, parseISO } from 'date-fns';
import { ParsedCommit, CommitType } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN environment variable is required');
}

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  },
});

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  labels: Array<{ name: string }>;
}

function parseConventionalCommit(message: string): {
  type: CommitType;
  scope?: string;
  breaking: boolean;
  message: string;
  description?: string;
} {
  // Match conventional commit format
  const regex = /^(feat|fix|docs|perf|refactor|test|build|chore)(?:\(([^)]+)\))?(!)?:\s*(.+)(?:\n\n([\s\S]*))?$/i;
  const match = message.match(regex);

  if (match) {
    const [, type, scope, breaking, msg, desc] = match;
    return {
      type: mapCommitType(type),
      scope: scope,
      breaking: !!breaking || message.includes('BREAKING CHANGE:'),
      message: msg.trim(),
      description: desc?.trim(),
    };
  }

  // Check for breaking change in body
  const hasBreakingChange = message.includes('BREAKING CHANGE:');
  
  // Try to infer type from message content
  const lowerMessage = message.toLowerCase();
  let inferredType: CommitType = 'other';
  
  if (hasBreakingChange) inferredType = 'breaking';
  else if (lowerMessage.includes('fix') || lowerMessage.includes('bug')) inferredType = 'fix';
  else if (lowerMessage.includes('feat')) inferredType = 'feature';
  else if (lowerMessage.includes('doc')) inferredType = 'docs';
  else if (lowerMessage.includes('perf')) inferredType = 'perf';
  else if (lowerMessage.includes('test')) inferredType = 'test';
  else if (lowerMessage.includes('build') || lowerMessage.includes('deps')) inferredType = 'build';
  else if (lowerMessage.includes('refactor')) inferredType = 'refactor';

  // Split message into title and description
  const [title, ...descLines] = message.split('\n');
  const description = descLines.join('\n').trim();

  return {
    type: inferredType,
    breaking: hasBreakingChange,
    message: title.trim(),
    description: description || undefined,
  };
}

function mapCommitType(type: string): CommitType {
  const typeMap: Record<string, CommitType> = {
    feat: 'feature',
    fix: 'fix',
    docs: 'docs',
    perf: 'perf',
    refactor: 'refactor',
    test: 'test',
    build: 'build',
    chore: 'other',
  };
  return typeMap[type.toLowerCase()] || 'other';
}

export async function fetchCommits(
  owner: string,
  repo: string,
  fromDate?: string,
  toDate?: string,
  fromCommit?: string,
  toCommit?: string
): Promise<ParsedCommit[]> {
  const commits: ParsedCommit[] = [];
  let page = 1;
  const perPage = 100;
  let reachedFromCommit = !fromCommit;
  
  while (true) {
    console.log(`Fetching page ${page} of commits...`);
    // If we have a fromCommit, first fetch it to get its date
    if (fromCommit && !reachedFromCommit) {
      try {
        const fromCommitResponse = await githubApi.get<GitHubCommit>(`/repos/${owner}/${repo}/commits/${fromCommit}`);
        fromDate = fromCommitResponse.data.commit.author.date;
        reachedFromCommit = true;
        console.log(`Using date from fromCommit: ${fromDate}`);
      } catch (error) {
        console.error(`Failed to get date for fromCommit ${fromCommit}, falling back to SHA-based filtering. This is less efficient but will still work.`);
      }
    }

    const response = await githubApi.get<GitHubCommit[]>(`/repos/${owner}/${repo}/commits`, {
      params: {
        page,
        per_page: perPage,
        ...(toCommit && { sha: toCommit }),
        ...(fromDate && { since: fromDate }), // Use GitHub's since parameter if we have a date
      },
    });

    if (response.data.length === 0) break;

    console.log(`Got ${response.data.length} commits on page ${page}`);
    
    for (const commit of response.data) {
      console.log(`Processing commit ${commit.sha.substring(0, 7)}: ${commit.commit.message.split('\n')[0]}`);
      
      // If we couldn't get the date for fromCommit, fall back to SHA-based filtering
      if (fromCommit && !fromDate && !reachedFromCommit) {
        if (commit.sha === fromCommit) {
          console.log(`Using SHA-based filtering: Found fromCommit ${fromCommit.substring(0, 7)}, including it and all commits after`);
          reachedFromCommit = true;
        } else {
          continue;
        }
      }

      const date = commit.commit.author.date;
      
      // Only need to check toDate since fromDate is handled by API
      if (toDate && isAfter(parseISO(date), parseISO(toDate))) continue;

      // Parse commit message
      const parsed = parseConventionalCommit(commit.commit.message);

      // Try to extract PR number
      const prMatch = commit.commit.message.match(/\(#(\d+)\)|\n\n#(\d+)/);
      const prNumber = prMatch ? parseInt(prMatch[1] || prMatch[2]) : undefined;

      commits.push({
        sha: commit.sha,
        type: parsed.type,
        scope: parsed.scope,
        message: parsed.message,
        description: parsed.description,
        breaking: parsed.breaking,
        author: commit.commit.author.name,
        date,
        prNumber,
        commitUrl: commit.html_url,
      });
    }

    page++;
  }

  console.log(`Total commits collected: ${commits.length}`);
  console.log('First (newest) commit:', commits[0]?.message);
  console.log('Last (oldest) commit:', commits[commits.length - 1]?.message);
  
  // Keep commits in reverse chronological order (newest first) for release notes
  return commits;
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequest | null> {
  try {
    const response = await githubApi.get<PullRequest>(
      `/repos/${owner}/${repo}/pulls/${prNumber}`
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getVersionFromPackageJson(owner: string, repo: string): Promise<string | undefined> {
  try {
    const packageJsonPath = join(process.cwd(), owner, repo, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    return packageJson.version;
  } catch {
    return undefined;
  }
}

export async function enrichCommitsWithPRData(
  owner: string,
  repo: string,
  commits: ParsedCommit[]
): Promise<ParsedCommit[]> {
  const enrichedCommits = [...commits];

  for (const commit of enrichedCommits) {
    if (!commit.prNumber) continue;

    const pr = await fetchPullRequest(owner, repo, commit.prNumber);
    if (!pr) continue;

    // Update commit type based on PR labels if not already determined
    if (commit.type === 'other') {
      const labels = pr.labels.map(l => l.name.toLowerCase());
      if (labels.some(l => l.includes('breaking'))) commit.breaking = true;
      if (labels.some(l => l.includes('feature'))) commit.type = 'feature';
      else if (labels.some(l => l.includes('bug') || l.includes('fix'))) commit.type = 'fix';
      else if (labels.some(l => l.includes('doc'))) commit.type = 'docs';
      else if (labels.some(l => l.includes('perf'))) commit.type = 'perf';
      else if (labels.some(l => l.includes('refactor'))) commit.type = 'refactor';
      else if (labels.some(l => l.includes('test'))) commit.type = 'test';
      else if (labels.some(l => l.includes('build'))) commit.type = 'build';
    }

    // Use PR title if commit message is not descriptive enough
    if (commit.message.length < pr.title.length) {
      commit.message = pr.title;
    }

    // Add PR description if commit has no description
    if (!commit.description && pr.body) {
      commit.description = pr.body;
    }
  }

  return enrichedCommits;
}
