#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  GenerateNotesSchema,
  AnalyzeCommitsSchema,
  ConfigureTemplateSchema,
} from './types.js';
import { fetchCommits, enrichCommitsWithPRData, getVersionFromPackageJson } from './github.js';
import { generateReleaseNotes } from './releaseNotes.js';

const server = new Server(
  {
    name: 'release-notes-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Store custom templates
const templates: Record<string, string> = {};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'generate_release_notes',
      description: 'Generate release notes from commits in a given timeframe or commit range',
      inputSchema: zodToJsonSchema(GenerateNotesSchema),
    },
    {
      name: 'analyze_commits',
      description: 'Analyze commits and provide statistics',
      inputSchema: zodToJsonSchema(AnalyzeCommitsSchema),
    },
    {
      name: 'configure_template',
      description: 'Configure a custom template for release notes',
      inputSchema: zodToJsonSchema(ConfigureTemplateSchema),
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case 'generate_release_notes': {
        const args = GenerateNotesSchema.parse(request.params.arguments);
        
        // Fetch commits based on time range or commit range
        // Try to get version from package.json
        const version = await getVersionFromPackageJson(args.owner, args.repo);
        
        const commits = await fetchCommits(
          args.owner,
          args.repo,
          args.timeRange?.from,
          args.timeRange?.to,
          args.commitRange?.fromCommit,
          args.commitRange?.toCommit
        );

        // Enrich commits with PR data
        const enrichedCommits = await enrichCommitsWithPRData(args.owner, args.repo, commits);

        // Generate release notes
        const notes = generateReleaseNotes(enrichedCommits, {
          format: args.format?.type,
          groupBy: args.format?.groupBy,
          includeStats: args.format?.includeStats,
          template: args.format?.template ? templates[args.format.template] : undefined,
          version,
        });

        return {
          content: [{ type: 'text', text: notes }],
        };
      }

      case 'analyze_commits': {
        const args = AnalyzeCommitsSchema.parse(request.params.arguments);
        
        // Fetch commits
        const commits = await fetchCommits(
          args.owner,
          args.repo,
          args.timeRange?.from,
          args.timeRange?.to,
          args.commitRange?.fromCommit,
          args.commitRange?.toCommit
        );

        // Enrich commits with PR data
        const enrichedCommits = await enrichCommitsWithPRData(args.owner, args.repo, commits);

        // Generate analysis with stats
        const analysis = generateReleaseNotes(enrichedCommits, {
          format: 'json',
          includeStats: true,
        });

        return {
          content: [{ type: 'text', text: analysis }],
        };
      }

      case 'configure_template': {
        const args = ConfigureTemplateSchema.parse(request.params.arguments);
        templates[args.name] = args.template;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: `Template '${args.name}' configured successfully` }),
            },
          ],
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Release Notes MCP Server running on stdio');
}

runServer().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
