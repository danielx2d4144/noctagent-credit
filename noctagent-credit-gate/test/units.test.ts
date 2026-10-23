import { describe, expect, it } from "vitest";
import { EXIT, formatResult, parseArgs } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { InMemoryCreditLineStore } from "../src/creditLines.js";
import { isUnknownKeyReject, parseToolResult, RegistryToolError } from "../src/registry/mcpClient.js";

describe("parseToolResult", () => {
  it("parses JSON text and the literal null", () => {
    expect(parseToolResult("is_active", { content: [{ type: "text", text: '{"active":true}' }] })).toEqual({ active: true });
    expect(parseToolResult("agent_of", { content: [{ type: "text", text: "null" }] })).toBeNull();
  });
  it("throws RegistryToolError on isError or non-JSON", () => {
    expect(() => parseToolResult("x", { isError: true, content: [{ type: "text", text: "boom" }] })).toThrow(RegistryToolError);
    expect(() => parseToolResult("x", { content: [{ type: "text", text: "oops" }] })).toThrow(/non-JSON/);
  });
  it("recognises the owner_of_key -7102 reject as 'no binding'", () => {
    expect(isUnknownKeyReject(new RegistryToolError("owner_of_key", "contract rejected: -7102"))).toBe(true);
    expect(isUnknownKeyReject(new RegistryToolError("owner_of_key", "timeout"))).toBe(false);
    expect(isUnknownKeyReject(new RegistryToolError("agent_of", "-7102"))).toBe(false);
  });
});

describe("InMemoryCreditLineStore", () => {
  it("opens idempotently, draws within limit, repays to floor 0", () => {
    const s = new InMemoryCreditLineStore();
    s.open("1", "A", 100);
    expect(s.open("1", "B", 5).owner).toBe("A");
    expect(() => s.recordDraw("1", 101)).toThrow();
    s.recordDraw("1", 60);
    expect(s.recordRepay("1", 500).drawn).toBe(0);
  });
  it("returns copies, not live references", () => {
    const s = new InMemoryCreditLineStore();
    s.open("1", "A", 100).drawn = 99;
    expect(s.get("1")?.drawn).toBe(0);
  });
  it("unfreeze clears the reason", () => {
    const s = new InMemoryCreditLineStore();
    s.open("1", "A", 100);
    s.freeze("1", "revoked");
    const u = s.unfreeze("1");
    expect(u.frozen).toBe(false);
    expect(u).not.toHaveProperty("frozenReason");
  });
});

describe("loadConfig", () => {
  it("defaults to testnet and the official testnet registry", () => {
    const c = loadConfig({});
    expect(c.network).toBe("testnet");
    expect(c.trustedCis8004).toEqual({ index: 12802, subindex: 0 });
    expect(c.policy.onCardUnavailable).toBe("deny");
  });
  it("reads overrides and rejects bad values", () => {
    const c = loadConfig({ NOCT_DEFAULT_CAP: "250", NOCT_OWNER_CAPS: '{"A":5}', MCP_CIS8004_CONTRACT: "1,0" });
    expect(c.policy.defaultCap).toBe(250);
    expect(c.policy.ownerCaps).toEqual({ A: 5 });
    expect(c.trustedCis8004).toEqual({ index: 1, subindex: 0 });
    expect(() => loadConfig({ MCP_NETWORK: "moon" })).toThrow();
  });
});

describe("cli", () => {
  it("parses args", () => {
    expect(parseArgs(["check", "853", "50", "--json", "--cap", "200"])).toMatchObject({ agent: "853", amount: 50, json: true, cap: 200 });
    expect(() => parseArgs(["853"])).toThrow(/usage/);
    expect(() => parseArgs(["853", "5", "--bogus"])).toThrow(/unknown flag/);
  });
  it("maps decisions to exit codes", () => {
    expect(EXIT).toEqual({ approve: 0, deny: 1, freeze: 2, error: 3 });
  });
  it("formats a result", () => {
    const out = formatResult({
      agent: "853", network: "testnet", requestedAmount: 5, decision: "approve", reason: "ok", approvedLimit: 5,
      checkedAt: "", errors: [],
      findings: { tokenResolved: { ok: true, input: "853", via: "token_id" }, registryStatus: "active", ownerAccount: "A",
        agentCardHash: "match", externalKeyBinding: { checked: false }, creditLine: { limit: 100, drawn: 0, remaining: 100, frozen: false, cap: 100 } },
    });
    expect(out).toMatch(/^APPROVE/);
    expect(out).toMatch(/0\/100 drawn/);
  });
});
