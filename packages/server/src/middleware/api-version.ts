import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Current API version prefix. */
export const API_VERSION = "v1";

/** Mount path for the versioned API. */
export const API_PREFIX = `/${API_VERSION}`;

/**
 * RFC 8594 `Sunset` value: one release after the deprecation date.
 * Kept as a fixed date so the header is stable across requests.
 */
export const API_SUNSET = "Wed, 31 Dec 2026 23:59:59 GMT";

/** RFC 9745 `Deprecation` value (deprecation date). */
export const API_DEPRECATION = "@1767225600";

/**
 * Marks a response as coming from a deprecated unversioned alias.
 * Adds `Deprecation`, `Sunset` and a `Link` pointing at the versioned route.
 */
export function markDeprecated(req: Request, res: Response): void {
  res.setHeader("Deprecation", API_DEPRECATION);
  res.setHeader("Sunset", API_SUNSET);
  const target = `${API_PREFIX}${req.originalUrl.split("?")[0]}`;
  res.setHeader("Link", `<${target}>; rel="successor-version"`);
}

/**
 * Middleware that stamps deprecation headers on every response served by an
 * unversioned alias route.
 */
export const deprecationHeaders: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  markDeprecated(req, res);
  next();
};

/**
 * Mounts `router` at both the versioned prefix and the deprecated unversioned
 * alias, so existing clients keep working for one release.
 */
export function mountVersioned(
  app: { use: (path: string, ...handlers: RequestHandler[]) => unknown },
  path: string,
  router: RequestHandler,
): void {
  app.use(`${API_PREFIX}${path}`, router);
  app.use(path, deprecationHeaders, router);
}
