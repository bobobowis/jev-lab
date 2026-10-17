/**
 * Level 10, option C: the spend ledger. Every ask_jev call is counted against the agent's own spend.
 * Lives in @bobobowis/jev-kit; re-exported here so the level reads the same.
 */
export { emptyLedger, record, summarize, JEV_INPUT_USD_PER_M, type Ledger, type JevUsage } from "@bobobowis/jev-kit/ledger";
