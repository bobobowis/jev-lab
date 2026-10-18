export const SHUTDOWN_HEADER: string;
export const SHUTDOWN_VALUE: string;
export function shutdownRefusal(req: { method?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string | null;
