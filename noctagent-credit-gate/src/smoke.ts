/**
 * Live smoke test: connect to the Agent Registry MCP (hosted by default, or NOCT_MCP_URL),
 * list tools, and run is_active / agent_of on a real testnet agent.
 *   npx tsx src/smoke.ts [tokenId]
 */
import { loadConfig } from "./config.js";
import { McpRegistryClient } from "./registry/mcpClient.js";

const cfg = loadConfig();
const tokenId = process.argv[2] ?? "853";
const client = new McpRegistryClient(cfg);

try {
  await client.connect();
  console.log(`connected: ${cfg.mcpUrl} via ${client.transportUsed}, network=${cfg.network}`);
  console.log("server:", JSON.stringify(client.serverInfo()));
  const tools = await client.listTools();
  console.log(`tools (${tools.length}):`, tools.map((t) => t.name).join(", "));
  console.log(`is_active(${tokenId}):`, JSON.stringify(await client.isActive(tokenId)));
  const rec = await client.agentOf(tokenId);
  console.log(`agent_of(${tokenId}):`, JSON.stringify(rec));
  try {
    const list = await client.listAgents({ limit: 2, status: "Active" });
    console.log(`list_agents: total=${list.total}, first=${list.agents.map((a) => a.token_id).join(",")}`);
  } catch (e) {
    console.log("list_agents failed (needs indexer):", (e as Error).message);
  }
} catch (e) {
  console.error("SMOKE FAILED:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.close();
}
