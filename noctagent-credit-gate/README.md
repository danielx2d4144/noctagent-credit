# noctagent-credit-gate

The credit gate for NoctAgent Credit (Concordium Trusted Agents Hackathon). Before the testnet pool lends to an AI agent, the gate checks the agent against the Concordium Agent Registry (CIS-8004) over its MCP server and returns separate findings plus one decision: `approve`, `deny` or `freeze`.

## What it checks, in order (fails closed)
1. **Request**: the amount must be a positive, finite number.
2. **Agent identity**: a token id, a Base58Check token address, or a CAIP-19 badge (`ccd:<genesis>/cis-2:<addr>`). A badge has to be from this network and from the trusted CIS-8004 contract (testnet `<12802,0>`).
3. **Registry status**: checked with `is_active` and `agent_of`. If either one says Revoked, the agent counts as revoked. If both lookups error, the gate denies.
4. **Revocation**: a revoked agent is denied. If it already has a line, the line is **frozen** and stays frozen until manual review, even if the registry later shows it Active again.
5. **Agent Card**: checked with `verify_agent_card`. A 2xx response that hashes differently is a mismatch and always denies. A 404, a 5xx or a missing URI counts as *unavailable*, which denies by default (`NOCT_CARD_UNAVAILABLE=allow` relaxes that).
6. **External key (CIS-8)**: when the agent declares a key, or the caller passes one, `owner_of_key` must show an Active binding to the agent's own owner account.
7. **Credit line**: per owner, the cap is `min(stored line, current owner cap)`. If the agent NFT has changed owner, the line is frozen. Requests above the remaining line are denied.

The gate never draws on the line. The pool calls `store.recordDraw` after it lends, and `recordRepay` on repayment.

## Use
```bash
npm install
npm test                                   # 46 unit tests (mock registry, no network)
npm run check -- 853 50                    # live testnet check; exit 0 approve, 1 deny, 2 freeze, 3 error
npm run check -- 853 50 --json             # full findings as JSON
npm run check -- 974 50 --allow-unverified-card --cap 200
npx tsx src/smoke.ts [tokenId]             # MCP connectivity smoke test
```
Env: `MCP_NETWORK` (testnet), `NOCT_MCP_URL` (hosted by default, or a self-hosted server), `NOCT_DEFAULT_CAP`, `NOCT_OWNER_CAPS` (JSON), `NOCT_CARD_UNAVAILABLE`, `MCP_CIS8004_CONTRACT`. See `src/config.ts`.

## Live testnet results (Oct 23, 2026)
| Agent | Case | Result |
|---|---|---|
| 853 | Active, card matches | APPROVE 50 of 100 |
| 969 | Revoked | DENY (revoked) |
| 0 | Active, card URL 404 | DENY (card unavailable) |
| 974 | Active, CIS-8 key bound to owner, no card | DENY by default; APPROVE with `--allow-unverified-card` (key bound to owner) |
| 999999 | Does not exist | DENY (not registered) |

## Layout
- `src/checkCredit.ts`: the gate itself.
- `src/creditLines.ts`: the credit-line store interface, plus an in-memory stand-in for the on-chain pool.
- `src/registry/`: the MCP client and the response types. `owner_of_key`'s `-7102` reject is mapped to "no binding".
- `src/cli.ts`, `src/smoke.ts`: the CLI and the smoke test.
- `test/`: the mock registry and the tests.
- `NOTES.md`: live-server findings, real tool names and schemas, and the test agents.

Next: Concordium ID proof → credit tier (it feeds `ownerCaps`), then the Rust pool contract, which re-checks the registry on `borrow` itself so the gate isn't the only guard.
