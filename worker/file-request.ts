/**
 * App pages and server functions never put a dot in their path, so a dot
 * means a file. Static assets are served before the Worker runs, so a file
 * request that gets here is missing: a stale asset or a scanner probing for
 * secrets like `/.env` or `/config.php`. These skip server rendering.
 */
export const isFileRequest = (pathname: string) => pathname.includes(".");
