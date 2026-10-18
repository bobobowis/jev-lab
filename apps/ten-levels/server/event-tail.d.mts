export interface EventTail {
  /** Read everything written so far, synchronously. */
  flush(): void;
  stop(): void;
}

export function tailEventDir(
  dir: string,
  onEvent: (event: any, file: string) => void,
  opts?: { pollMs?: number; onError?: (err: Error) => void },
): EventTail;
