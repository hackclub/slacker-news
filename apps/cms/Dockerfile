FROM oven/bun:1.3.12-alpine AS base
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
CMD ["sh", "-c", "bun run dev"]

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/cms/node_modules ./apps/cms/node_modules
COPY apps/cms/ apps/cms/
COPY packages/ packages/
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_OPTIONS="--max-old-space-size=1024 --no-deprecation"
ENV NEXT_PRIVATE_BUILD_WORKER=1
RUN cd apps/cms && bun run build

FROM base AS runner
WORKDIR /app/apps/cms
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
RUN apk add --no-cache nodejs
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/tsconfig.json ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/scripts/seed-trigger.mjs ./
COPY apps/web/src/content/posts /app/mdx-posts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules /app/node_modules
COPY --from=deps --chown=nextjs:nodejs /app/apps/cms/node_modules /app/apps/cms/node_modules
USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["sh", "-c", "/usr/bin/node /app/apps/cms/node_modules/.bin/payload migrate && (bun run start &) && sleep 8 && /usr/bin/node seed-trigger.mjs && wait"]
