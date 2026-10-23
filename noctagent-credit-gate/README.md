# noctagent-credit-gate (step 1 of the NoctAgent Credit build)

The credit gate for NoctAgent Credit (Concordium Trusted Agents Hackathon). An AI borrowing agent may borrow from the testnet pool only when it is a registered, Active CIS-8004 agent with a verified owner.

**Status: step 1 is done.** It has an MCP client wrapper for the Concordium Agent Registry MCP (testnet) and a live smoke test. The credit policy, CLI, tests and full README are still to come. Draft policy code exists in `src/checkCredit.ts` and `src/creditLines.ts`, but it is not finished or tested.

```bash
npm install
npx tsx src/smoke.ts [tokenId]     # defaults to testnet agent 853
NOCT_MCP_URL=http://localhost:3000/mcp npx tsx src/smoke.ts   # self-hosted server
```

See NOTES.md for the endpoint findings, exact tool names and schemas, and the smoke output.
