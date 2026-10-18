/**
 * Level 8, shared: the file becomes Jev's state, never the agent's context.
 * Lives in @bobobowis/jev-kit; re-exported here so the level reads the same.
 */
export { readFileState, FileStateError, MAX_FILE_CHARS, toPosix, isInside, type FileState } from "@bobobowis/jev-kit/files";
