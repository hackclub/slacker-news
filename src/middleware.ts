import { defineMiddleware } from "astro:middleware";
import { getAuth } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  // EmDash's own middleware has already signed its user in for these routes,
  // and it keeps that user in `locals.user` too. Leave it alone.
  if (context.url.pathname.startsWith("/_emdash/")) return next();

  if (context.isPrerendered) {
    context.locals.user = null;
    context.locals.session = null;
    return next();
  }

  const session = await getAuth().api.getSession({
    headers: context.request.headers,
  });

  context.locals.user = session?.user ?? null;
  context.locals.session = session?.session ?? null;
  return next();
});
