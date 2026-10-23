# NOTES: Concordium Agent Registry MCP (live findings, 2026-10-23)

## Endpoint and transport
- Hosted server: `https://agent-registry-mcp.concordium.com/mcp`. Send JSON-RPC 2.0 with POST. **No auth is needed.**
  - `GET /` returns a plain-text banner: `concordium-agent-registry-mcp v0.1.0`. `GET /healthz` is the health check.
  - `GET /mcp` returns 405, which means there is no server-initiated SSE stream. `/sse` returns 404, so there is no legacy SSE transport.
  - POST replies come back as `application/json` (no SSE framing). The server negotiates protocolVersion `2024-11-05` and advertises capabilities `tools.listChanged=false`.
- The official `@modelcontextprotocol/sdk` (1.32.x) `StreamableHTTPClientTransport` connects without problems. `src/registry/mcpClient.ts` uses it and falls back to SSE when `NOCT_MCP_TRANSPORT=auto`.
- **Gotcha:** the hosted server defaults `network` to **mainnet**, so the client passes `network: "testnet"` on every call. `parse_token_address` and `token_address` are the exceptions because they take no network.
- Self-hosted fallback (from the docs): `docker run -e MCP_NETWORK=testnet -e MCP_INDEXER_URL=... -p 3000:3000 concordium/agent-registry-mcp:latest`, then set `NOCT_MCP_URL=http://localhost:3000/mcp`. Server env vars: `MCP_NETWORK`, `MCP_GRPC_ENDPOINT`, `MCP_INDEXER_URL` (needed for list/search/recent/history), `MCP_CIS8004_CONTRACT`, `MCP_CIS8_CONTRACT`. Client env vars: `NOCT_MCP_URL`, `MCP_NETWORK` (the client defaults to testnet), `NOCT_MCP_TRANSPORT`, `NOCT_MCP_AUTH` (sets an Authorization header).

## Testnet facts (from `contract_info` / `agent_registry_capabilities`, network=testnet)
- CIS-8004 is at `12802,0` (module `142462ff…a5c6`) and CIS-8 is at `12801,0`. Mainnet, per the docs, uses 10082,0 and 10081,0.
- gRPC: `https://grpc.testnet.concordium.com:20000`. The hosted indexer is configured, so `list_agents` works. On testnet, all 38 tools are available and `unavailable_tools` is empty.
- CAIP-2 testnet prefix: `ccd:4221332d34e1694168c2a0c0b3fd0f27`.
- The registry holds about 975 agents: `list_agents` showed 853 Active and 122 Revoked.

## Docs vs live server
- The docs say "35 tools", but the live server has **38**. The three extras are `build_agent_badge`, `check_account_badges` and `build_set_external_reference`.
- **There is no `get_agent` tool.** Agent lookup uses `agent_of(token_id)` or `agent_by_token_address(token_address)`.
- The docs say `agent_of` takes an account. **Live, it takes `token_id`.** Use `agents_by_owner(owner_account)` for lookups by account.
- `verify_agent_card` returns `match:false` even when the card fetch got a 404 or 530. Check `fetched.http_status` to tell "unreachable" apart from "tampered". It returns `match:null` when the agent has no agent_uri.
- `owner_of_key` with an unknown key returns `isError:true` with a contract reject (`-7102`) rather than `null`.
- The badge string is the agent NFT's Base58Check token address, or its CAIP-19 form `ccd:<genesis32>/cis-2:<base58>`. Use `parse_token_address` to get it back to `(contract, token_id)`.

## Tools the credit gate uses (exact args, from live `tools/list`)
| Tool | Required args | Optional | Returns (trimmed, live) |
|---|---|---|---|
| `is_active` | `token_id` (decimal string or u64 int) | `network` | `{"exists":true,"status":"Active","active":true}`. Revoked: `status:"Revoked",active:false`. Missing: `exists:false,status:null` |
| `agent_of` | `token_id` | `network` | `{token_address, token_id, owner_account, agent_uri, metadata_hash_hex, external_reference?, agent_wallet, status, registered_at}` or `null` |
| `agent_by_token_address` | `token_address` (Base58Check) | `network` | same record as `agent_of` |
| `verify_agent_card` | `token_id` | `fetch` (default true), `network` | `{on_chain_uri, on_chain_hash_hex, fetched:{http_status,byte_length,sha256_hex,body_preview}, match}` |
| `owner_of_key` | `external_key:{namespace,key_type,public_key_hex}` | `network` | `{owner, external_key, proof_scheme, metadata:[{key:"external_address",value:"0x…"}], status:"Active", last_updated}` |
| `list_agents` | none | `limit` (1-500, default 100), `offset`, `status` ("Active"/"Revoked"), `owner`, `network` | `{count,total,agents:[{token_id,owner_account,agent_uri,metadata_hash_hex,agent_wallet,status,registered_at,revoked_at?,revocation_reason?}]}` |
| `parse_token_address` | `token_address` | none (no network) | `{contract_index, contract_subindex, token_id, …}` |
| `agents_by_owner` | `owner_account` | `limit` (≤1000), `network` | agents owned by the account |
| `check_account_badges` | `owner_account` | `network` | per-agent badge validity summary |

Every tool result is one `text` content block holding JSON. A missing record is the literal `null`. Errors set `isError:true` and carry plain text.

## Full tool list (38)
Discovery (indexer): `list_agents`, `search_agents`, `recent_registrations`, `recent_transfers`, `agent_history`.
On-chain reads: `agent_by_token_address`, `agent_by_external_reference`, `agents_by_owner`, `agent_of`, `get_metadata`, `get_agent_wallet`, `is_active`, `owner_of_key`, `check_account_badges`.
CIS-8004 builders: `build_register`, `build_revoke`, `build_set_agent_uri`, `build_set_metadata`, `build_set_agent_wallet`, `build_set_external_reference`, `build_transfer`, `build_transfer_admin`, `build_update_operator`, `build_upgrade`, `build_set_external_registries`.
CIS-8 builders: `build_cis8_canonical_bytes`, `build_cis8_register`, `build_cis8_revoke`, `build_cis8_update_metadata`, `set_agent_wallet_canonical_bytes`.
Utilities: `build_agent_card`, `build_agent_badge`, `verify_agent_card`, `token_address`, `parse_token_address`, `agent_registry_capabilities`, `network_status`, `contract_info`.
Full JSON input schemas are in `notes-raw/schemas.md`. The raw dump is `notes-raw/tools.json`.

## Smoke test result (`npx tsx src/smoke.ts 853`), PASS
```
connected: https://agent-registry-mcp.concordium.com/mcp via streamable-http, network=testnet
server: {"name":"concordium-agent-registry-mcp","version":"0.1.0"}
tools (38): agent_by_external_reference, agent_by_token_address, ... verify_agent_card
is_active(853): {"exists":true,"status":"Active","active":true}
agent_of(853): {"token_address":"JyP9VVSsN3EXxw7ziywEL","owner_account":"3FCRLpYr…9eWtp","agent_uri":"https://arena.test.dotdotdotarena.com/v1/cards/Xy5EAtdVTPlb_eH6.json","status":"Active",...}
list_agents: total=853 (Active filter), first=0,1
is_active(969): {"exists":true,"status":"Revoked","active":false}
```

## Useful real testnet agents for later steps
- **853**: Active, and its card hash matches (verify_agent_card match:true, HTTP 200). This is the "approve" case.
- **969**: Revoked, card matches. This is the "revoked → freeze/deny" case.
- **0**: Active, but its card URL returns 404 (`match:false`, http 404). This is the "card unavailable" case.
- **974**: Active, with a Cis8 external_reference (eip155:8453). Its `owner_of_key` binding owner `4fT52zFG…6hwT` is the same account as the agent owner. This is the external-key-binding case.
- **999999**: does not exist (`exists:false`). This is the "unknown" case.
