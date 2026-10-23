/**
 * NoctAgent credit gate CLI.
 *   npm run check -- <agent> <amount> [--json] [--cap N] [--allow-unverified-card]
 *   <agent> = token id ("853"), Base58Check token address, or CAIP-19 badge.
 * Exit codes: 0 approve, 1 deny, 2 freeze, 3 usage/connection error.
 */
import { checkCredit, type CreditCheckResult } from "./checkCredit.js";
import { loadConfig } from "./config.js";
import { InMemoryCreditLineStore } from "./creditLines.js";
import { McpRegistryClient } from "./registry/mcpClient.js";

export const EXIT = { approve: 0, deny: 1, freeze: 2, error: 3 } as const;

export function parseArgs(argv: string[]) {
  const pos: string[] = [];
  let json = false;
  let cap: number | undefined;
  let allowCard = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--allow-unverified-card") allowCard = true;
    else if (a === "--cap") cap = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else pos.push(a);
  }
  if (pos[0] === "check") pos.shift();
  if (pos.length !== 2) throw new Error("usage: check <agent> <amount> [--json] [--cap N] [--allow-unverified-card]");
  const amount = Number(pos[1]);
  if (cap !== undefined && (!Number.isFinite(cap) || cap < 0)) throw new Error("--cap must be a non-negative number");
  return { agent: pos[0], amount, json, cap, allowCard };
}

export function formatResult(r: CreditCheckResult): string {
  const f = r.findings;
  const lines = [
    `${r.decision.toUpperCase()}  agent ${r.agent} on ${r.network}, requested ${r.requestedAmount}`,
    `  reason:        ${r.reason}`,
    `  registry:      ${f.registryStatus}`,
    `  owner:         ${f.ownerAccount ?? "-"}`,
    `  agent card:    ${f.agentCardHash}${f.agentCardDetail?.httpStatus ? ` (HTTP ${f.agentCardDetail.httpStatus})` : ""}`,
    `  external key:  ${!f.externalKeyBinding?.checked ? "none declared" : f.externalKeyBinding.bound ? (f.externalKeyBinding.matchesAgentOwner ? "bound to owner" : "bound to OTHER account") : "not bound"}`,
  ];
  if (f.creditLine) {
    const c = f.creditLine;
    lines.push(`  credit line:   ${c.drawn}/${c.limit} drawn, ${c.remaining} left${c.frozen ? ", FROZEN" : ""}`);
  }
  lines.push(`  approved:      ${r.approvedLimit}`);
  if (r.errors.length) lines.push(`  errors:        ${r.errors.join("; ")}`);
  return lines.join("\n");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    return EXIT.error;
  }
  const cfg = loadConfig();
  if (args.cap !== undefined) cfg.policy.defaultCap = args.cap;
  if (args.allowCard) cfg.policy.onCardUnavailable = "allow";
  const registry = new McpRegistryClient(cfg);
  try {
    const r = await checkCredit(args.agent, args.amount, {
      registry,
      store: new InMemoryCreditLineStore(),
      policy: cfg.policy,
      trustedCis8004: cfg.trustedCis8004,
    });
    console.log(args.json ? JSON.stringify(r, null, 2) : formatResult(r));
    return EXIT[r.decision];
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return EXIT.error;
  } finally {
    await registry.close();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cli.ts");
if (isMain) process.exitCode = await main();
