/**
 * Stands in for submitters.ts when the site is built without EmDash: there is
 * no admin to guard, and nothing here may import EmDash.
 */
import type { APIContext, MiddlewareNext } from "astro";

export function submitterGate(
  _context: APIContext,
  next: MiddlewareNext,
): Promise<Response> {
  return next();
}
