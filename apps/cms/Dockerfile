FROM oven/bun:1-alpine AS base
RUN apk add --no-cache libc6-compat

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/cms/package.json apps/cms/
COPY packages/ packages/
RUN bun install

FROM base AS dev
WORKDIR /app/apps/cms
COPY --from=deps /app/node_modules /app/node_modules
COPY packages/ /app/packages/
COPY apps/cms/ .
EXPOSE 3000
ENV PORT 3000
CMD ["bun", "run", "dev"]

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/cms/ apps/cms/
COPY packages/ packages/
RUN cd apps/cms && bun run build

FROM base AS runner
WORKDIR /app/apps/cms
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/cms/public ./public
RUN mkdir -p .next && chown nextjs:nodejs .next
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
