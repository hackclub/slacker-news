FROM oven/bun:1.3.12-alpine AS build
RUN apk add --no-cache libc6-compat
ARG CMS_URL=http://cms:3000
ENV CMS_URL=$CMS_URL
ENV NODE_OPTIONS="--max-old-space-size=1024"
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/ packages/
RUN bun install
COPY apps/web/ apps/web/
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:1.3.12-alpine AS runner
WORKDIR /app
COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV HOST=0.0.0.0 PORT=80
EXPOSE 80
CMD ["bun", "dist/server/entry.mjs"]
