/**
 * Credit-line bookkeeping, keyed by agent token id.
 *
 * TODO(on-chain pool): this in-memory store is a stand-in for the NoctAgent lending pool
 * contract on Concordium testnet. When the pool exists, implement `CreditLineStore` against it:
 *   - get()      -> view the pool's per-agent line (limit, drawn, frozen)
 *   - open()     -> pool `openLine(token_id, owner, limit)` (gate/admin-signed)
 *   - recordDraw -> happens on-chain inside pool `borrow(token_id, amount)`; the pool should
 *                   itself re-check `is_active` / owner via CIS-8004 so the gate is not the only guard
 *   - freeze()   -> pool `freezeLine(token_id)` (called by the revocation watcher)
 * Amounts are integer test-PLT units here; switch to bigint + token decimals for the real PLT.
 */

export interface CreditLine {
  tokenId: string;
  owner: string;
  limit: number;
  drawn: number;
  frozen: boolean;
  frozenReason?: string;
  frozenAt?: string;
}

export interface CreditLineStore {
  get(tokenId: string): CreditLine | undefined;
  open(tokenId: string, owner: string, limit: number): CreditLine;
  recordDraw(tokenId: string, amount: number): CreditLine;
  recordRepay(tokenId: string, amount: number): CreditLine;
  freeze(tokenId: string, reason: string): CreditLine;
  unfreeze(tokenId: string): CreditLine;
  all(): CreditLine[];
}

export class InMemoryCreditLineStore implements CreditLineStore {
  private lines = new Map<string, CreditLine>();

  get(tokenId: string) {
    const l = this.lines.get(tokenId);
    return l ? { ...l } : undefined;
  }

  open(tokenId: string, owner: string, limit: number) {
    const existing = this.lines.get(tokenId);
    if (existing) return { ...existing };
    const line: CreditLine = { tokenId, owner, limit, drawn: 0, frozen: false };
    this.lines.set(tokenId, line);
    return { ...line };
  }

  private must(tokenId: string) {
    const l = this.lines.get(tokenId);
    if (!l) throw new Error(`No credit line for agent ${tokenId}`);
    return l;
  }

  recordDraw(tokenId: string, amount: number) {
    const l = this.must(tokenId);
    if (l.frozen) throw new Error(`Credit line for agent ${tokenId} is frozen`);
    if (amount <= 0 || l.drawn + amount > l.limit) throw new Error(`Draw ${amount} exceeds remaining line`);
    l.drawn += amount;
    return { ...l };
  }

  recordRepay(tokenId: string, amount: number) {
    const l = this.must(tokenId);
    l.drawn = Math.max(0, l.drawn - amount);
    return { ...l };
  }

  freeze(tokenId: string, reason: string) {
    const l = this.must(tokenId);
    if (!l.frozen) {
      l.frozen = true;
      l.frozenReason = reason;
      l.frozenAt = new Date().toISOString();
    }
    return { ...l };
  }

  unfreeze(tokenId: string) {
    const l = this.must(tokenId);
    l.frozen = false;
    delete l.frozenReason;
    delete l.frozenAt;
    return { ...l };
  }

  all() {
    return [...this.lines.values()].map((l) => ({ ...l }));
  }
}
