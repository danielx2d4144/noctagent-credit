import { DEFAULT_POLICY, GENESIS_PREFIX, type PolicyConfig } from "./config.js";
import type { CreditLineStore } from "./creditLines.js";
import type { ContractAddress, ExternalKey, RegistryClient } from "./registry/types.js";

export type Decision = "approve" | "deny" | "freeze";

export interface TokenResolvedFinding {
  ok: boolean;
  input: string;
  via: "token_id" | "badge" | null;
  tokenId?: string;
  tokenAddress?: string;
  contract?: ContractAddress;
  contractTrusted?: boolean;
  error?: string;
}

export interface ExternalKeyBindingFinding {
  checked: boolean;
  source?: "agent_external_reference" | "caller_supplied";
  key?: ExternalKey;
  bound?: boolean; // an active CIS-8 registration exists
  bindingOwner?: string | null;
  matchesAgentOwner?: boolean;
  externalAddress?: string; // from registration metadata `external_address`, if present
  error?: string;
}

export interface CreditCheckResult {
  agent: string;
  network: string;
  requestedAmount: number;
  findings: {
    tokenResolved: TokenResolvedFinding;
    registryStatus: "active" | "revoked" | "unknown";
    ownerAccount: string | null;
    agentCardHash: "match" | "mismatch" | "unavailable";
    agentCardDetail?: { onChainHash: string | null; fetchedHash?: string; httpStatus?: number; uri: string | null };
    externalKeyBinding?: ExternalKeyBindingFinding;
    creditLine?: { limit: number; drawn: number; remaining: number; frozen: boolean; cap: number };
  };
  decision: Decision;
  reason: string;
  /** Amount the pool may lend for THIS request (0 unless approved). Never exceeds the remaining line. */
  approvedLimit: number;
  checkedAt: string;
  errors: string[];
}

export interface CheckCreditDeps {
  registry: RegistryClient;
  store: CreditLineStore;
  policy?: PolicyConfig;
  trustedCis8004?: ContractAddress | null;
}

export interface CheckCreditOptions {
  /** Optional external key to check via owner_of_key (else the agent's own Cis8 reference is used). */
  externalKey?: ExternalKey;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
/** CAIP-19 badge: ccd:<genesis32>/cis-2:<base58> */
const CAIP19 = /^ccd:([0-9a-f]{32})\/cis-2:([1-9A-HJ-NP-Za-km-z]+)$/i;

async function resolveToken(
  input: string,
  registry: RegistryClient,
  trusted: ContractAddress | null | undefined,
): Promise<TokenResolvedFinding> {
  const s = input.trim();
  if (/^\d+$/.test(s)) {
    return { ok: true, input, via: "token_id", tokenId: s, contract: trusted ?? undefined, contractTrusted: !!trusted };
  }
  let short = s;
  const caip = CAIP19.exec(s);
  if (caip) {
    const expected = GENESIS_PREFIX[registry.network];
    if (expected && caip[1].toLowerCase() !== expected) {
      return { ok: false, input, via: "badge", error: `badge is for chain ccd:${caip[1]}, not ${registry.network} (ccd:${expected})` };
    }
    short = caip[2];
  }
  if (!BASE58.test(short)) {
    return { ok: false, input, via: null, error: "not a token id, Base58Check token address, or CAIP-19 badge" };
  }
  try {
    const p = await registry.parseTokenAddress(short);
    const contract = { index: p.contract_index, subindex: p.contract_subindex };
    const contractTrusted = !!trusted && trusted.index === contract.index && trusted.subindex === contract.subindex;
    const base = { input, via: "badge" as const, tokenId: String(p.token_id), tokenAddress: short, contract, contractTrusted };
    if (!contractTrusted) {
      return { ...base, ok: false, error: `badge resolves to contract <${contract.index},${contract.subindex}>, not the trusted CIS-8004 registry` };
    }
    return { ...base, ok: true };
  } catch (e) {
    return { ok: false, input, via: "badge", error: (e as Error).message };
  }
}

/**
 * Credit gate. Reads the Agent Registry and the credit-line store, returns separate findings
 * and a decision. Side effects: opens a line on first approval-eligible check, freezes a line
 * when the agent is revoked. It does NOT draw: the pool calls `store.recordDraw` after lending.
 */
export async function checkCredit(
  agent: string,
  requestedAmount: number,
  deps: CheckCreditDeps,
  opts: CheckCreditOptions = {},
): Promise<CreditCheckResult> {
  const policy = deps.policy ?? DEFAULT_POLICY;
  const { registry, store } = deps;
  const errors: string[] = [];
  const result: CreditCheckResult = {
    agent,
    network: registry.network,
    requestedAmount,
    findings: {
      tokenResolved: { ok: false, input: agent, via: null },
      registryStatus: "unknown",
      ownerAccount: null,
      agentCardHash: "unavailable",
    },
    decision: "deny",
    reason: "",
    approvedLimit: 0,
    checkedAt: new Date().toISOString(),
    errors,
  };
  const deny = (reason: string) => {
    result.decision = "deny";
    result.reason = reason;
    result.approvedLimit = 0;
    return result;
  };

  // 0. Request sanity
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return deny("requested amount must be a positive number");
  }

  // 1. Resolve token
  const tr = await resolveToken(agent, registry, deps.trustedCis8004);
  result.findings.tokenResolved = tr;
  if (!tr.ok || !tr.tokenId) return deny(`could not resolve agent: ${tr.error ?? "unknown"}`);
  const tokenId = tr.tokenId;

  // 2. Registry status (is_active)
  try {
    const st = await registry.isActive(tokenId);
    result.findings.registryStatus = !st.exists ? "unknown" : st.active ? "active" : st.status === "Revoked" ? "revoked" : "unknown";
  } catch (e) {
    errors.push(`is_active: ${(e as Error).message}`);
  }

  // 3. Owner (agent_of) - also gives token address + external reference
  let externalRefKey: ExternalKey | undefined;
  try {
    const rec = await registry.agentOf(tokenId);
    if (rec) {
      result.findings.ownerAccount = rec.owner_account;
      if (!tr.tokenAddress) tr.tokenAddress = rec.token_address;
      if (rec.external_reference?.kind === "Cis8" && rec.external_reference.key) externalRefKey = rec.external_reference.key;
      // Reconcile with is_active. Revocation wins any disagreement (fail closed); otherwise
      // agent_of fills in when is_active failed or was inconclusive.
      if (rec.status === "Revoked") {
        if (result.findings.registryStatus === "active") errors.push("is_active and agent_of disagree; treating agent as revoked");
        result.findings.registryStatus = "revoked";
      } else if (result.findings.registryStatus === "unknown" && rec.status === "Active") {
        result.findings.registryStatus = "active";
      }
    }
  } catch (e) {
    errors.push(`agent_of: ${(e as Error).message}`);
  }

  // 4. Revocation -> freeze (checked before anything else can approve)
  const existing = store.get(tokenId);
  if (result.findings.registryStatus === "revoked") {
    if (existing) {
      const frozen = store.freeze(tokenId, "agent revoked in CIS-8004 registry");
      result.findings.creditLine = lineView(frozen, frozen.limit);
      result.decision = "freeze";
      result.reason = "agent is revoked in the Agent Registry; existing credit line frozen";
      result.approvedLimit = 0;
      return result;
    }
    return deny("agent is revoked in the Agent Registry");
  }
  if (result.findings.registryStatus !== "active") {
    return deny(errors.length ? "registry status could not be confirmed (registry error)" : "agent is not registered");
  }
  if (!result.findings.ownerAccount) return deny("owner account could not be resolved");

  // 5. Agent Card integrity (verify_agent_card)
  try {
    const v = await registry.verifyAgentCard(tokenId);
    result.findings.agentCardDetail = {
      onChainHash: v.on_chain_hash_hex,
      fetchedHash: v.fetched?.sha256_hex,
      httpStatus: v.fetched?.http_status,
      uri: v.on_chain_uri,
    };
    const ok2xx = !!v.fetched && v.fetched.http_status >= 200 && v.fetched.http_status < 300;
    // match=false is also returned when the fetch got a 404/5xx page; only a 2xx body that
    // hashes differently is a true mismatch.
    result.findings.agentCardHash = v.match === true ? "match" : v.match === false && ok2xx ? "mismatch" : "unavailable";
  } catch (e) {
    errors.push(`verify_agent_card: ${(e as Error).message}`);
  }
  if (result.findings.agentCardHash === "mismatch") return deny("Agent Card hash does not match the on-chain metadata_hash");
  if (result.findings.agentCardHash === "unavailable" && policy.onCardUnavailable === "deny") {
    return deny("Agent Card could not be verified (unreachable or missing) and policy requires it");
  }

  // 6. Optional external key binding (owner_of_key)
  const key = opts.externalKey ?? externalRefKey;
  if (key) {
    const f: ExternalKeyBindingFinding = {
      checked: true,
      source: opts.externalKey ? "caller_supplied" : "agent_external_reference",
      key,
    };
    try {
      const reg = await registry.ownerOfKey(key);
      f.bound = !!reg && reg.status === "Active";
      f.bindingOwner = reg?.owner ?? null;
      f.matchesAgentOwner = !!reg && reg.owner === result.findings.ownerAccount;
      f.externalAddress = reg?.metadata?.find((m) => m.key === "external_address")?.value;
    } catch (e) {
      f.error = (e as Error).message;
      errors.push(`owner_of_key: ${f.error}`);
    }
    result.findings.externalKeyBinding = f;
    if (f.bound && !f.matchesAgentOwner) return deny("external key is bound to a different Concordium account than the agent owner");
    if (policy.requireExternalKeyBindingWhenDeclared && !f.bound) {
      return deny(f.error ? "external key binding could not be checked" : "declared external key has no active CIS-8 binding");
    }
  } else {
    result.findings.externalKeyBinding = { checked: false };
  }

  // 7. Credit line + cap
  const owner = result.findings.ownerAccount;
  const cap = policy.ownerCaps[owner] ?? policy.defaultCap;
  const line = existing ?? store.open(tokenId, owner, cap);
  const view = lineView(line, cap);
  result.findings.creditLine = view;
  if (line.frozen) return deny(`credit line is frozen (${line.frozenReason ?? "no reason recorded"}); needs manual review`);
  if (line.owner !== owner) {
    // NFT was transferred since the line was opened: the old owner's line must not follow the token.
    store.freeze(tokenId, "agent NFT owner changed");
    result.findings.creditLine = lineView(store.get(tokenId)!, cap);
    result.decision = "freeze";
    result.reason = "agent owner changed since the line was opened; line frozen for review";
    return result;
  }
  if (requestedAmount > view.remaining) {
    return deny(`requested ${requestedAmount} exceeds remaining line ${view.remaining} (cap ${view.limit})`);
  }

  result.decision = "approve";
  result.reason =
    result.findings.agentCardHash === "match"
      ? "registered, active agent with verified card and available line"
      : "registered, active agent with available line (Agent Card unverified; allowed by policy)";
  result.approvedLimit = Math.min(requestedAmount, view.remaining);
  return result;
}

function lineView(l: { limit: number; drawn: number; frozen: boolean }, cap: number) {
  // Effective limit is the lower of the stored line and the current owner cap (caps can be lowered).
  const limit = Math.min(l.limit, cap);
  return { limit, drawn: l.drawn, remaining: Math.max(0, limit - l.drawn), frozen: l.frozen, cap };
}
