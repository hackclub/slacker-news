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
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_OPTIONS="--max-old-space-size=4096 --no-deprecation"
RUN cd apps/cms && npx next build

FROM base AS runner
WORKDIR /app/apps/cms
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/package.json ./
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["npx", "next", "start"]
