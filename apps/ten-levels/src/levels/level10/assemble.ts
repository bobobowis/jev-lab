/**
 * Level 10, shared: the state ask_jev sends is assembled in code, refused with a split when it is too big.
 * Lives in @bobobowis/jev-kit; re-exported here so the level reads the same.
 */
export { assembleState, overflowMessage, suggestSplit, tokensOf, AskStateError, STATE_TOKEN_BUDGET, MAX_FILES_PER_CALL, MAX_OWN_STATE_CHARS, type AssembleInput, type Assembled, type CommandOutput, type RunCommand } from "@bobobowis/jev-kit/files";
