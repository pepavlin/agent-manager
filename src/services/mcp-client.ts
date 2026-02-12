import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { getConfig } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import type { ToolInput } from '../types/index.js';

const logger = createChildLogger('mcp');

// Config schema matching Claude Desktop format
const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
});

const McpConfigSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema),
});

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolInput[];
}

/**
 * Manages connections to MCP servers and provides tool discovery/execution.
 */
class McpClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /**
   * Connect to all configured MCP servers.
   */
  async connectAll(configs: Record<string, McpServerConfig>): Promise<void> {
    const entries = Object.entries(configs).filter(([_, cfg]) => cfg.enabled);

    const results = await Promise.allSettled(
      entries.map(([name, cfg]) => this.connectServer(name, cfg)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const name = entries[i][0];
      if (result.status === 'rejected') {
        logger.warn({ server: name, error: String(result.reason) }, 'MCP server connection failed');
      }
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env as Record<string, string>, ...config.env } : undefined,
      stderr: 'pipe',
    });

    const client = new Client(
      { name: 'agent-manager', version: '1.0.0' },
    );

    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools.map((t) => convertMcpToolToToolInput(name, t));

    this.servers.set(name, { name, client, transport, tools });
    logger.info(
      { server: name, tools: tools.map((t) => t.name) },
      'MCP server connected',
    );
  }

  /**
   * Return all discovered MCP tools (converted to agent ToolInput format).
   */
  getTools(): ToolInput[] {
    const tools: ToolInput[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  /**
   * Execute an MCP tool by its full name (mcp.<server>.<tool>).
   */
  async executeTool(
    fullName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) {
      return { ok: false, error: `Invalid MCP tool name: ${fullName}` };
    }

    const server = this.servers.get(parsed.serverName);
    if (!server) {
      return { ok: false, error: `MCP server not found: ${parsed.serverName}` };
    }

    try {
      const result = await server.client.callTool({
        name: parsed.toolName,
        arguments: args,
      }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean; toolResult?: unknown };

      // Extract text from content blocks
      if (result.content && Array.isArray(result.content)) {
        const isError = result.isError === true;
        const textParts = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text);
        const text = textParts.join('\n');

        if (isError) {
          return { ok: false, error: text || 'MCP tool returned an error' };
        }
        return { ok: true, data: text };
      }

      // Legacy toolResult format
      if ('toolResult' in result) {
        return { ok: true, data: result.toolResult };
      }

      return { ok: true, data: result };
    } catch (error) {
      logger.error({ error, tool: fullName }, 'MCP tool execution failed');
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Close all MCP server connections.
   */
  async shutdown(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.servers.entries()).map(async ([name, server]) => {
        await server.client.close();
        logger.info({ server: name }, 'MCP server disconnected');
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn({ error: String(result.reason) }, 'MCP server disconnect failed');
      }
    }

    this.servers.clear();
  }
}

/**
 * Convert an MCP tool definition to the agent's ToolInput format.
 */
function convertMcpToolToToolInput(
  serverName: string,
  mcpTool: { name: string; description?: string; inputSchema: { properties?: Record<string, object>; required?: string[] } },
): ToolInput {
  const parameters: Record<string, { type: string; description?: string; required?: boolean }> = {};

  if (mcpTool.inputSchema.properties) {
    const requiredSet = new Set(mcpTool.inputSchema.required ?? []);

    for (const [key, schema] of Object.entries(mcpTool.inputSchema.properties)) {
      const s = schema as { type?: string; description?: string };
      parameters[key] = {
        type: s.type ?? 'string',
        description: s.description,
        required: requiredSet.has(key),
      };
    }
  }

  return {
    name: `mcp.${serverName}.${mcpTool.name}`,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    requires_approval: false,
    risk: 'low',
  };
}

/**
 * Parse a full MCP tool name into server and tool parts.
 * Format: mcp.<serverName>.<toolName>
 */
function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  if (!fullName.startsWith('mcp.')) return null;

  // Split into exactly 3 parts: "mcp", serverName, toolName
  // toolName may contain dots, so only split on first two dots
  const withoutPrefix = fullName.slice(4); // remove "mcp."
  const dotIndex = withoutPrefix.indexOf('.');
  if (dotIndex === -1) return null;

  const serverName = withoutPrefix.slice(0, dotIndex);
  const toolName = withoutPrefix.slice(dotIndex + 1);

  if (!serverName || !toolName) return null;
  return { serverName, toolName };
}

/**
 * Check if a tool name is an MCP tool.
 */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp.');
}

// --- Module-level singleton ---

let _manager: McpClientManager | null = null;

/**
 * Initialize MCP clients from config file. Logs warnings on failure, never throws.
 */
export async function initMcpClients(): Promise<void> {
  const config = getConfig();
  if (!config.mcpConfigPath) {
    logger.debug('No MCP_CONFIG_PATH configured, skipping MCP initialization');
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(config.mcpConfigPath, 'utf-8');
  } catch (err) {
    logger.warn({ path: config.mcpConfigPath, error: String(err) }, 'Failed to read MCP config file');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ path: config.mcpConfigPath, error: String(err) }, 'Failed to parse MCP config JSON');
    return;
  }

  const validated = McpConfigSchema.safeParse(parsed);
  if (!validated.success) {
    logger.warn({ errors: validated.error.format() }, 'Invalid MCP config schema');
    return;
  }

  const serverCount = Object.keys(validated.data.mcpServers).length;
  if (serverCount === 0) {
    logger.debug('No MCP servers configured');
    return;
  }

  _manager = new McpClientManager();
  await _manager.connectAll(validated.data.mcpServers);

  const tools = _manager.getTools();
  logger.info({ toolCount: tools.length }, 'MCP initialization complete');
}

/**
 * Get the MCP client manager (may be null if not initialized or no config).
 */
export function getMcpClientManager(): McpClientManager | null {
  return _manager;
}

/**
 * Shutdown all MCP connections.
 */
export async function shutdownMcpClients(): Promise<void> {
  if (_manager) {
    await _manager.shutdown();
    _manager = null;
  }
}
