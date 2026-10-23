import type {
  AgentRecord, ExternalKey, IsActiveResult, KeyRegistration, ListAgentsResult,
  ParsedTokenAddress, RegistryClient, VerifyAgentCardResult,
} from "../src/registry/types.js";

export const OWNER = "3FCRLpYrYdBNkbaBkrK2kmcnrdNqa4wSDYWGAWGZvG6Xi9eWtp";
export const OTHER = "4fT52zFGotherAccountxxxxxxxxxxxxxxxxxxxxxxxxx6hwT";
export const KEY: ExternalKey = { namespace: "eip155:8453", key_type: "secp256k1-compressed", public_key_hex: "02ab" };

export interface MockAgent {
  status?: "Active" | "Revoked" | null; // null = not registered
  owner?: string;
  card?: { match: boolean | null; http?: number } | "throw";
  externalKey?: ExternalKey;
  isActiveThrows?: boolean;
  agentOfThrows?: boolean;
  isActiveStatus?: "Active" | "Revoked" | null; // override is_active alone
}

/** In-memory RegistryClient. Mutate `agents`/`keys` between calls to simulate chain changes. */
export class MockRegistry implements RegistryClient {
  readonly network = "testnet" as const;
  calls: string[] = [];
  agents = new Map<string, MockAgent>();
  keys = new Map<string, KeyRegistration | "throw">();
  tokenAddresses = new Map<string, ParsedTokenAddress>();

  set(id: string, a: MockAgent) { this.agents.set(id, { status: "Active", owner: OWNER, card: { match: true, http: 200 }, ...a }); return this; }

  async isActive(id: string): Promise<IsActiveResult> {
    this.calls.push(`is_active:${id}`);
    const a = this.agents.get(id);
    if (a?.isActiveThrows) throw new Error("indexer timeout");
    const st = a ? (a.isActiveStatus !== undefined ? a.isActiveStatus : a.status ?? null) : null;
    return { exists: st !== null, status: st, active: st === "Active" };
  }

  async agentOf(id: string): Promise<AgentRecord | null> {
    this.calls.push(`agent_of:${id}`);
    const a = this.agents.get(id);
    if (a?.agentOfThrows) throw new Error("node unavailable");
    if (!a || !a.status) return null;
    return {
      network: "testnet", token_address: `TA${id}`, token_id: id, token_id_u64: Number(id),
      owner_account: a.owner!, status: a.status,
      external_reference: a.externalKey ? { kind: "Cis8", contract_address: { index: 12801, subindex: 0 }, key: a.externalKey } : null,
    };
  }

  async verifyAgentCard(id: string): Promise<VerifyAgentCardResult> {
    this.calls.push(`verify_agent_card:${id}`);
    const c = this.agents.get(id)?.card ?? { match: null };
    if (c === "throw") throw new Error("fetch failed");
    return {
      network: "testnet", token_id: id, on_chain_uri: "https://example.test/card.json", on_chain_hash_hex: "aa",
      fetched: c.http ? { http_status: c.http, byte_length: 10, sha256_hex: c.match ? "aa" : "bb" } : undefined,
      match: c.match,
    };
  }

  async ownerOfKey(key: ExternalKey): Promise<KeyRegistration | null> {
    this.calls.push("owner_of_key");
    const r = this.keys.get(key.public_key_hex);
    if (r === "throw") throw new Error("node unavailable");
    return r ?? null;
  }

  async parseTokenAddress(addr: string): Promise<ParsedTokenAddress> {
    const p = this.tokenAddresses.get(addr);
    if (!p) throw new Error("invalid token address checksum");
    return p;
  }

  async listAgents(): Promise<ListAgentsResult> { return { network: "testnet", count: 0, total: 0, agents: [] }; }
}

export function binding(owner: string): KeyRegistration {
  return { network: "testnet", owner, external_key: KEY, proof_scheme: "secp256k1", status: "Active",
    metadata: [{ key: "external_address", value: "0xabc" }] };
}
