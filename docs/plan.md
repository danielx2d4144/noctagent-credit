# NoctAgent Credit: Concordium Trusted Agents Hackathon (Nov 2, 2026, 6 weeks)

Concept: an AI borrowing agent that borrows from a Noct-style lending pool on Concordium testnet only within limits tied to its owner's privately verified Concordium ID, and repays over x402.

Key dates: Checkpoint 1 Sun Nov 22, 23:59 UTC (create project, add team, share idea). Submission Wed Dec 9, 23:59 UTC (description + components used, public repo, demo video <=3 min, CCDExplorer link, path to production).

## Core pieces
1. Agent Registry gate (CIS-8004 NFT, did:ccd, Verified badge) via the hosted registry MCP. Built: noctagent-credit-gate/ (step 1 done).
2. Concordium ID ZK proofs: owner proves age/residency/uniqueness privately; proof sets the credit tier.
3. Testnet pool contract (core, was implicit): Concordium smart contract (Rust, concordium-std) holding a PLT stablecoin.
   - deposit / withdraw for lenders
   - borrow(agent_token_id, amount): checks agent is Active in registry 12802,0 and amount <= tier limit
   - repay(agent_token_id, amount) and accrued fixed interest
   - revoke hook: a Revoked agent's line is frozen (no new borrows)
   - deployed on testnet; every borrow/repay visible on CCDExplorer (the submission link)
4. x402 repayments (promoted from stretch to core): the agent repays the pool over x402, with sponsored transactions so the owner never handles CCD fees. Pool (or a thin facilitator service) exposes an x402 paywalled /repay endpoint; agent pays, contract records the repayment.
5. Revocation demo: revoke agent in registry -> next borrow fails live on camera.

## Week plan
- Wk1 (Nov 2): workshops; finish credit policy + CLI + tests on the gate; read x402 and PLT docs.
- Wk2 (Nov 9): pool contract spec + Rust skeleton (deposit/borrow/repay), unit tests.
- Wk3 (Nov 16): deploy pool to testnet; wire gate -> borrow. Checkpoint 1 by Sun Nov 22, 23:59 UTC.
- Wk4 (Nov 23): ID ZK proof -> credit tier; x402 /repay endpoint with sponsored tx.
- Wk5 (Nov 30): agent loop (check -> borrow -> use -> repay over x402), revocation path, end-to-end on testnet.
- Wk6 (Dec 7): UI, demo video, README + path to production, submit before Wed Dec 9, 23:59 UTC.

## Risks
- Agent IDP spending-limit credentials are on the roadmap, so contract-enforced limits are the fallback.
- x402 on Concordium is new: if the facilitator is flaky, keep repay() callable directly and show x402 as the primary path.
- PLT availability on testnet: fallback is a CIS-2 test stablecoin.
