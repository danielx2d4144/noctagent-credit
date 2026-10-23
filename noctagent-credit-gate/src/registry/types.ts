/**
 * Shapes returned by the Concordium Agent Registry MCP server (v0.1.0).
 * Captured live from https://agent-registry-mcp.concordium.com/mcp on 2026-10-23
 * (see NOTES.md and notes-raw/tools.json). Fields not used by the gate are optional.
 */

export type Network = "mainnet" | "testnet" | "devnet";

export interface ContractAddress {
  index: number;
  subindex: number;
}

export interface ExternalKey {
  namespace: string; // CAIP-2 chain id, e.g. "eip155:8453"
  key_type: string; // "secp256k1-uncompressed" | "secp256k1-compressed" | "ed25519"
  public_key_hex: string; // hex, no 0x
}

/** ExternalReference as stored on a CIS-8004 agent (kind is always "Cis8" today). */
export interface ExternalReference {
  contract_address: ContractAddress;
  kind: "Cis8";
  key?: ExternalKey;
}

/** `is_active` result. */
export interface IsActiveResult {
  exists: boolean;
  status: "Active" | "Revoked" | null;
  active: boolean;
}

/** `agent_of` / `agent_by_token_address` result (null when no agent). */
export interface AgentRecord {
  network: Network;
  token_address: string;
  token_id: string;
  token_id_u64: number;
  owner_account: string;
  agent_uri?: string | null;
  metadata_hash_hex?: string | null;
  external_reference?: ExternalReference | null;
  agent_wallet?: string | null;
  status: "Active" | "Revoked";
  registered_at?: string;
  revoked_at?: string;
  revocation_reason?: string;
}

/** `verify_agent_card` result. `match` is null when either side is missing. */
export interface VerifyAgentCardResult {
  network: Network;
  token_id: string;
  on_chain_uri: string | null;
  on_chain_hash_hex: string | null;
  fetched?: {
    http_status: number;
    byte_length: number;
    sha256_hex: string;
    body_preview?: string;
  };
  match: boolean | null;
}

/** `owner_of_key` result (null when no active binding). */
export interface KeyRegistration {
  network: Network;
  owner: string;
  external_key: ExternalKey;
  proof_scheme: string;
  metadata?: { key: string; value: string }[];
  status: string; // "Active" observed
  last_updated?: string;
}

/** `parse_token_address` result. */
export interface ParsedTokenAddress {
  token_address?: string;
  contract_index: number;
  contract_subindex: number;
  token_id: string;
  token_id_u64?: number;
}

/** `list_agents` result. */
export interface ListAgentsResult {
  network: Network;
  count: number;
  total: number;
  agents: Array<{
    network: Network;
    token_id: number;
    owner_account: string;
    agent_uri?: string | null;
    metadata_hash_hex?: string | null;
    agent_wallet?: string | null;
    status: "Active" | "Revoked";
    registered_at?: string;
    revoked_at?: string;
    revocation_reason?: string;
    last_event_block?: number;
  }>;
}

export interface ListAgentsOptions {
  limit?: number;
  offset?: number;
  status?: "Active" | "Revoked";
  owner?: string;
}

/**
 * The subset of registry operations the credit gate depends on.
 * `McpRegistryClient` implements it over MCP; tests implement it with a mock.
 */
export interface RegistryClient {
  readonly network: Network;
  isActive(tokenId: string): Promise<IsActiveResult>;
  agentOf(tokenId: string): Promise<AgentRecord | null>;
  verifyAgentCard(tokenId: string): Promise<VerifyAgentCardResult>;
  ownerOfKey(key: ExternalKey): Promise<KeyRegistration | null>;
  parseTokenAddress(tokenAddress: string): Promise<ParsedTokenAddress>;
  listAgents(opts?: ListAgentsOptions): Promise<ListAgentsResult>;
}
