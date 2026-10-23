import { beforeEach, describe, expect, it } from "vitest";
import { checkCredit } from "../src/checkCredit.js";
import { DEFAULT_POLICY, GENESIS_PREFIX, type PolicyConfig } from "../src/config.js";
import { InMemoryCreditLineStore } from "../src/creditLines.js";
import { binding, KEY, MockRegistry, OTHER, OWNER } from "./mockRegistry.js";

const TRUSTED = { index: 12802, subindex: 0 };
let reg: MockRegistry;
let store: InMemoryCreditLineStore;
const run = (agent: string, amt: number, policy: Partial<PolicyConfig> = {}, opts = {}) =>
  checkCredit(agent, amt, { registry: reg, store, policy: { ...DEFAULT_POLICY, ...policy }, trustedCis8004: TRUSTED }, opts);

beforeEach(() => {
  reg = new MockRegistry();
  store = new InMemoryCreditLineStore();
});

describe("approve path", () => {
  it("approves an active agent with a verified card and opens a line at the default cap", async () => {
    reg.set("853", {});
    const r = await run("853", 40);
    expect(r.decision).toBe("approve");
    expect(r.approvedLimit).toBe(40);
    expect(r.findings.registryStatus).toBe("active");
    expect(r.findings.ownerAccount).toBe(OWNER);
    expect(r.findings.agentCardHash).toBe("match");
    expect(r.findings.creditLine).toMatchObject({ limit: 100, drawn: 0, remaining: 100, frozen: false });
    expect(store.get("853")).toBeDefined();
  });

  it("uses a per-owner cap override", async () => {
    reg.set("853", {});
    const r = await run("853", 400, { ownerCaps: { [OWNER]: 500 } });
    expect(r.decision).toBe("approve");
    expect(r.findings.creditLine?.limit).toBe(500);
  });

  it("does not draw: two checks in a row both see the full line", async () => {
    reg.set("853", {});
    await run("853", 60);
    const r = await run("853", 60);
    expect(r.decision).toBe("approve");
    expect(r.findings.creditLine?.drawn).toBe(0);
  });
});

describe("limits", () => {
  it("denies a request above the remaining line after a draw", async () => {
    reg.set("853", {});
    await run("853", 70);
    store.recordDraw("853", 70);
    const r = await run("853", 40);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/exceeds remaining line 30/);
    expect(r.approvedLimit).toBe(0);
  });

  it("restores headroom after repayment", async () => {
    reg.set("853", {});
    await run("853", 70);
    store.recordDraw("853", 70);
    store.recordRepay("853", 50);
    expect((await run("853", 80)).decision).toBe("approve");
  });

  it("applies a lowered owner cap to an existing line", async () => {
    reg.set("853", {});
    await run("853", 10, { ownerCaps: { [OWNER]: 500 } });
    const r = await run("853", 300, { ownerCaps: { [OWNER]: 200 } });
    expect(r.decision).toBe("deny");
    expect(r.findings.creditLine?.limit).toBe(200);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("rejects amount %s without touching the registry", async (amt) => {
    reg.set("853", {});
    const r = await run("853", amt);
    expect(r.decision).toBe("deny");
    expect(reg.calls).toHaveLength(0);
  });
});

describe("revocation", () => {
  it("denies a revoked agent with no line, and opens none", async () => {
    reg.set("969", { status: "Revoked" });
    const r = await run("969", 10);
    expect(r.decision).toBe("deny");
    expect(r.findings.registryStatus).toBe("revoked");
    expect(store.get("969")).toBeUndefined();
  });

  it("freezes an existing line when the agent is revoked, and keeps it frozen", async () => {
    reg.set("853", {});
    await run("853", 10);
    store.recordDraw("853", 10);
    reg.set("853", { status: "Revoked" });
    const r = await run("853", 10);
    expect(r.decision).toBe("freeze");
    expect(r.approvedLimit).toBe(0);
    expect(store.get("853")).toMatchObject({ frozen: true, drawn: 10 });
    expect(() => store.recordDraw("853", 1)).toThrow(/frozen/);

    // Even if the registry later reports Active again, the frozen line stays shut until manual review.
    reg.set("853", {});
    const again = await run("853", 1);
    expect(again.decision).toBe("deny");
    expect(again.reason).toMatch(/frozen/);
  });

  it("checks revocation before the agent card (no card fetch for a revoked agent)", async () => {
    reg.set("969", { status: "Revoked" });
    await run("969", 10);
    expect(reg.calls).not.toContain("verify_agent_card:969");
  });

  it("treats the agent as revoked when is_active and agent_of disagree", async () => {
    reg.set("853", { status: "Revoked", isActiveStatus: "Active" });
    const r = await run("853", 10);
    expect(r.findings.registryStatus).toBe("revoked");
    expect(r.decision).toBe("deny");
    expect(r.errors.join()).toMatch(/disagree/);
  });

  it("freezes the line when the agent NFT changes owner", async () => {
    reg.set("853", {});
    await run("853", 10);
    reg.set("853", { owner: OTHER });
    const r = await run("853", 10);
    expect(r.decision).toBe("freeze");
    expect(r.reason).toMatch(/owner changed/);
    expect(store.get("853")?.frozen).toBe(true);
  });
});

describe("registry lookups", () => {
  it("denies an unregistered agent", async () => {
    const r = await run("999999", 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("agent is not registered");
  });

  it("falls back to agent_of when is_active errors", async () => {
    reg.set("853", { isActiveThrows: true });
    const r = await run("853", 10);
    expect(r.decision).toBe("approve");
    expect(r.errors[0]).toMatch(/^is_active/);
  });

  it("fails closed when both lookups error", async () => {
    reg.set("853", { isActiveThrows: true, agentOfThrows: true });
    const r = await run("853", 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/could not be confirmed/);
    expect(r.errors).toHaveLength(2);
  });
});

describe("agent card", () => {
  it("denies a true mismatch (2xx body, wrong hash)", async () => {
    reg.set("853", { card: { match: false, http: 200 } });
    const r = await run("853", 10);
    expect(r.findings.agentCardHash).toBe("mismatch");
    expect(r.decision).toBe("deny");
  });

  it("treats a 404 card as unavailable, not tampered", async () => {
    reg.set("0", { card: { match: false, http: 404 } });
    const r = await run("0", 10);
    expect(r.findings.agentCardHash).toBe("unavailable");
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/could not be verified/);
  });

  it("approves an unavailable card when policy allows", async () => {
    reg.set("0", { card: { match: false, http: 404 } });
    const r = await run("0", 10, { onCardUnavailable: "allow" });
    expect(r.decision).toBe("approve");
    expect(r.reason).toMatch(/unverified; allowed by policy/);
  });

  it("still denies a true mismatch when policy allows unavailable cards", async () => {
    reg.set("853", { card: { match: false, http: 200 } });
    expect((await run("853", 10, { onCardUnavailable: "allow" })).decision).toBe("deny");
  });

  it("treats a missing agent_uri and a verify error as unavailable", async () => {
    reg.set("1", { card: { match: null } });
    reg.set("2", { card: "throw" });
    expect((await run("1", 10)).findings.agentCardHash).toBe("unavailable");
    const r2 = await run("2", 10);
    expect(r2.findings.agentCardHash).toBe("unavailable");
    expect(r2.errors[0]).toMatch(/^verify_agent_card/);
  });
});

describe("external key binding (CIS-8)", () => {
  it("approves when the declared key is bound to the agent owner", async () => {
    reg.set("974", { externalKey: KEY });
    reg.keys.set(KEY.public_key_hex, binding(OWNER));
    const r = await run("974", 10);
    expect(r.decision).toBe("approve");
    expect(r.findings.externalKeyBinding).toMatchObject({ checked: true, bound: true, matchesAgentOwner: true, externalAddress: "0xabc", source: "agent_external_reference" });
  });

  it("denies when the key is bound to a different account", async () => {
    reg.set("974", { externalKey: KEY });
    reg.keys.set(KEY.public_key_hex, binding(OTHER));
    const r = await run("974", 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/different Concordium account/);
  });

  it("denies a declared key with no binding", async () => {
    reg.set("974", { externalKey: KEY });
    const r = await run("974", 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/no active CIS-8 binding/);
  });

  it("allows an unbound declared key when policy does not require binding", async () => {
    reg.set("974", { externalKey: KEY });
    expect((await run("974", 10, { requireExternalKeyBindingWhenDeclared: false })).decision).toBe("approve");
  });

  it("denies when the binding lookup errors", async () => {
    reg.set("974", { externalKey: KEY });
    reg.keys.set(KEY.public_key_hex, "throw");
    const r = await run("974", 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/could not be checked/);
  });

  it("checks a caller-supplied key on an agent with none declared", async () => {
    reg.set("853", {});
    reg.keys.set(KEY.public_key_hex, binding(OWNER));
    const r = await run("853", 10, {}, { externalKey: KEY });
    expect(r.findings.externalKeyBinding?.source).toBe("caller_supplied");
    expect(r.decision).toBe("approve");
  });

  it("skips the key check when none is declared or supplied", async () => {
    reg.set("853", {});
    const r = await run("853", 10);
    expect(r.findings.externalKeyBinding).toEqual({ checked: false });
    expect(reg.calls).not.toContain("owner_of_key");
  });
});

describe("agent identifiers", () => {
  const TA = "JyP9VVSsN3EXxw7ziywEL";

  it("accepts a Base58Check badge from the trusted registry", async () => {
    reg.set("853", {});
    reg.tokenAddresses.set(TA, { contract_index: 12802, contract_subindex: 0, token_id: "853" });
    const r = await run(TA, 10);
    expect(r.findings.tokenResolved).toMatchObject({ ok: true, via: "badge", tokenId: "853", contractTrusted: true });
    expect(r.decision).toBe("approve");
  });

  it("accepts a CAIP-19 badge on testnet", async () => {
    reg.set("853", {});
    reg.tokenAddresses.set(TA, { contract_index: 12802, contract_subindex: 0, token_id: "853" });
    expect((await run(`ccd:${GENESIS_PREFIX.testnet}/cis-2:${TA}`, 10)).decision).toBe("approve");
  });

  it("rejects a CAIP-19 badge from another chain", async () => {
    const r = await run(`ccd:${GENESIS_PREFIX.mainnet}/cis-2:${TA}`, 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/not testnet/);
  });

  it("rejects a badge from an untrusted contract", async () => {
    reg.tokenAddresses.set(TA, { contract_index: 9999, contract_subindex: 0, token_id: "853" });
    const r = await run(TA, 10);
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/not the trusted CIS-8004 registry/);
  });

  it("rejects garbage input and bad checksums", async () => {
    expect((await run("not a badge!", 10)).reason).toMatch(/not a token id/);
    expect((await run("JyP9VVSsN3EXxw7ziywEX", 10)).reason).toMatch(/checksum/);
  });
});
