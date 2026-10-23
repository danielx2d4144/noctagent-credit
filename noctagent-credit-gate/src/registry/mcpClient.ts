import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { GateConfig } from "../config.js";
import type {
  AgentRecord,
  ExternalKey,
  IsActiveResult,
  KeyRegistration,
  ListAgentsOptions,
  ListAgentsResult,
  Network,
  ParsedTokenAddress,
  RegistryClient,
  VerifyAgentCardResult,
} from "./types.js";

/** A tool call the server answered with `isError: true` (e.g. CIS-8 reject, indexer down). */
export class RegistryToolError extends Error {
  constructor(
    public readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
    this.name = "RegistryToolError";
  }
}

/** Could not reach / handshake with the MCP server at all. */
export class RegistryConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RegistryConnectionError";
  }
}

type ToolContent = { type: string; text?: string }[];

/**
 * Parse the server's tool output. The Concordium server returns a single text block
 * holding JSON (objects, or the literal `null` for "not found"). Errors come back as
 * plain text with isError=true.
 */
export function parseToolResult<T>(tool: string, result: { content?: unknown; isError?: unknown }): T {
  const content = (result.content ?? []) as ToolContent;
  const text = content.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) throw new RegistryToolError(tool, text || "unknown error");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RegistryToolError(tool, `non-JSON result: ${text.slice(0, 200)}`);
  }
}

/**
 * MCP client for the Concordium Agent Registry MCP server.
 * Works against the hosted server or a self-hosted one (docker `concordium/agent-registry-mcp`,
 * endpoint `http://localhost:3000/mcp`). Every call passes `network` explicitly because the
 * hosted server's default network is mainnet.
 */
export class McpRegistryClient implements RegistryClient {
  private client: Client | null = null;
  public transportUsed: "streamable-http" | "sse" | null = null;

  constructor(private readonly cfg: Pick<GateConfig, "mcpUrl" | "network" | "transport" | "headers">) {}

  get network(): Network {
    return this.cfg.network;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const url = new URL(this.cfg.mcpUrl);
    const requestInit: RequestInit = { headers: this.cfg.headers };
    const order: ("streamable-http" | "sse")[] =
      this.cfg.transport === "auto" ? ["streamable-http", "sse"] : [this.cfg.transport];
    const errors: string[] = [];
    for (const kind of order) {
      const client = new Client({ name: "noctagent-credit-gate", version: "0.1.0" });
      try {
        const transport =
          kind === "streamable-http"
            ? new StreamableHTTPClientTransport(url, { requestInit })
            : new SSEClientTransport(url, { requestInit });
        await client.connect(transport);
        this.client = client;
        this.transportUsed = kind;
        return;
      } catch (e) {
        errors.push(`${kind}: ${(e as Error).message}`);
        await client.close().catch(() => {});
      }
    }
    throw new RegistryConnectionError(
      `Could not connect to MCP server at ${this.cfg.mcpUrl} (${errors.join("; ")}). ` +
        `If the hosted endpoint is down or needs auth, run your own: ` +
        `docker run -e MCP_NETWORK=${this.cfg.network} -p 3000:3000 concordium/agent-registry-mcp:latest ` +
        `and set NOCT_MCP_URL=http://localhost:3000/mcp (NOCT_MCP_AUTH for an Authorization header).`,
    );
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.client = null;
  }

  async listTools() {
    await this.connect();
    const res = await this.client!.listTools();
    return res.tools;
  }

  serverInfo() {
    return this.client?.getServerVersion();
  }

  /** Raw call; adds `network` unless the tool is network-agnostic. */
  async call<T>(tool: string, args: Record<string, unknown> = {}, opts: { withNetwork?: boolean } = {}): Promise<T> {
    await this.connect();
    const finalArgs = opts.withNetwork === false ? args : { network: this.cfg.network, ...args };
    const res = await this.client!.callTool({ name: tool, arguments: finalArgs });
    return parseToolResult<T>(tool, res as { content?: unknown; isError?: unknown });
  }

  isActive(tokenId: string) {
    return this.call<IsActiveResult>("is_active", { token_id: tokenId });
  }

  agentOf(tokenId: string) {
    return this.call<AgentRecord | null>("agent_of", { token_id: tokenId });
  }

  agentByTokenAddress(tokenAddress: string) {
    return this.call<AgentRecord | null>("agent_by_token_address", { token_address: tokenAddress });
  }

  verifyAgentCard(tokenId: string) {
    return this.call<VerifyAgentCardResult>("verify_agent_card", { token_id: tokenId, fetch: true });
  }

  ownerOfKey(key: ExternalKey) {
    return this.call<KeyRegistration | null>("owner_of_key", { external_key: key });
  }

  /** Off-chain decode; this tool takes no `network` argument. */
  parseTokenAddress(tokenAddress: string) {
    return this.call<ParsedTokenAddress>("parse_token_address", { token_address: tokenAddress }, { withNetwork: false });
  }

  /** Needs the server's indexer (MCP_INDEXER_URL); errors otherwise. */
  listAgents(opts: ListAgentsOptions = {}) {
    return this.call<ListAgentsResult>("list_agents", { ...opts });
  }
}
