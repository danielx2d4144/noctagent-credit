# NoctAgent Credit

An AI borrowing agent that borrows from a lending pool on Concordium testnet only within limits tied to its owner's privately verified Concordium ID, gated by the Concordium Agent Registry and repaying over x402.

Built for Encode Club's Concordium Trusted Agents Hackathon (Nov 2 to Dec 9, 2026).

## Layout
- `docs/plan.md`: concept, core pieces, week plan, risks
- `docs/hackathon-rules.md`: the hackathon brief
- `noctagent-credit-gate/`: TypeScript credit gate that checks an agent against the Agent Registry via Concordium's hosted MCP server (testnet)

## Status
- Agent Registry gate: step 1 done (live smoke test passing on testnet)
- Credit policy, CLI, tests: in progress
- Testnet pool contract (Rust): planned
- x402 repayments with sponsored transactions: planned
