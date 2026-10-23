import type { ContractAddress, Network } from "./registry/types.js";

/** Hosted endpoint (confirmed live 2026-10-23: POST JSON-RPC to /mcp, no auth). */
export const HOSTED_MCP_URL = "https://agent-registry-mcp.concordium.com/mcp";

/**
 * Official CIS-8004 registry per network. Mainnet from the docs index page;
 * testnet from the live `contract_info` tool (network=testnet).
 */
export const OFFICIAL_CIS8004: Record<Network, ContractAddress | null> = {
  mainnet: { index: 10082, subindex: 0 },
  testnet: { index: 12802, subindex: 0 },
  devnet: null, // unknown; set MCP_CIS8004_CONTRACT
};

/** First 32 hex chars of each network's genesis hash (CAIP-2 `ccd:<this>`). */
export const GENESIS_PREFIX: Record<Network, string | null> = {
  mainnet: "9dd9ca4d19e9393877d2c44b70f89acb", // docs: concordium-badge.html
  testnet: "4221332d34e1694168c2a0c0b3fd0f27", // live: check_account_badges (testnet)
  devnet: null,
};

export interface GateConfig {
  /** MCP endpoint. Hosted by default; point at a self-hosted server (http://localhost:3000/mcp). */
  mcpUrl: string;
  /** Network passed explicitly on every tool call (the hosted server defaults to mainnet!). */
  network: Network;
  /** "streamable-http" (what the hosted server speaks), "sse", or "auto" (try HTTP, then SSE). */
  transport: "streamable-http" | "sse" | "auto";
  /** Optional extra headers (e.g. Authorization for a self-hosted server behind auth). */
  headers: Record<string, string>;
  /** CIS-8004 contract the gate trusts for badge/token-address input. */
  trustedCis8004: ContractAddress | null;
  policy: PolicyConfig;
}

export interface PolicyConfig {
  /** Default credit line per owner account, in test PLT units. */
  defaultCap: number;
  /** Per-owner overrides: owner Base58 account -> cap. */
  ownerCaps: Record<string, number>;
  /**
   * What to do when the Agent Card cannot be checked (no agent_uri, fetch failed, non-2xx).
   * "deny" (default, strict) or "allow".
   */
  onCardUnavailable: "deny" | "allow";
  /** If the agent declares a CIS-8 external reference, require an active binding to the same owner. */
  requireExternalKeyBindingWhenDeclared: boolean;
}

export const DEFAULT_POLICY: PolicyConfig = {
  defaultCap: 100,
  ownerCaps: {},
  onCardUnavailable: "deny",
  requireExternalKeyBindingWhenDeclared: true,
};

function parseContract(s: string | undefined): ContractAddress | null {
  if (!s) return null;
  const m = /^(\d+)[,.](\d+)$/.exec(s.trim());
  if (!m) throw new Error(`Bad contract address "${s}" (expected "index,subindex")`);
  return { index: Number(m[1]), subindex: Number(m[2]) };
}

function parseNetwork(s: string | undefined): Network {
  const n = (s ?? "testnet").toLowerCase();
  if (n === "mainnet" || n === "testnet" || n === "devnet") return n;
  throw new Error(`Bad MCP_NETWORK "${s}"`);
}

/**
 * Build config from env. Variable names reuse the MCP server's own (docs: mcp-service.html)
 * where they mean the same thing, so one .env can drive both a self-hosted server and the gate.
 *
 *   NOCT_MCP_URL          MCP endpoint (default hosted)
 *   MCP_NETWORK           mainnet | testnet | devnet (default testnet here; server default is devnet/mainnet)
 *   NOCT_MCP_TRANSPORT    streamable-http | sse | auto (default auto)
 *   NOCT_MCP_AUTH         optional value for an Authorization header
 *   MCP_CIS8004_CONTRACT  trusted CIS-8004 "index,subindex" override
 *   NOCT_DEFAULT_CAP      default per-owner cap (default 100)
 *   NOCT_OWNER_CAPS       JSON {"<owner account>": cap}
 *   NOCT_CARD_UNAVAILABLE deny | allow
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GateConfig {
  const network = parseNetwork(env.MCP_NETWORK);
  const headers: Record<string, string> = {};
  if (env.NOCT_MCP_AUTH) headers["Authorization"] = env.NOCT_MCP_AUTH;
  const transport = (env.NOCT_MCP_TRANSPORT ?? "auto") as GateConfig["transport"];
  if (!["streamable-http", "sse", "auto"].includes(transport)) {
    throw new Error(`Bad NOCT_MCP_TRANSPORT "${transport}"`);
  }
  return {
    mcpUrl: env.NOCT_MCP_URL ?? HOSTED_MCP_URL,
    network,
    transport,
    headers,
    trustedCis8004: parseContract(env.MCP_CIS8004_CONTRACT) ?? OFFICIAL_CIS8004[network],
    policy: {
      ...DEFAULT_POLICY,
      defaultCap: env.NOCT_DEFAULT_CAP ? Number(env.NOCT_DEFAULT_CAP) : DEFAULT_POLICY.defaultCap,
      ownerCaps: env.NOCT_OWNER_CAPS ? JSON.parse(env.NOCT_OWNER_CAPS) : {},
      onCardUnavailable: env.NOCT_CARD_UNAVAILABLE === "allow" ? "allow" : "deny",
    },
  };
}
