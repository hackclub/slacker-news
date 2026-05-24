FROM oven/bun:latest AS build
ARG CMS_URL=http://cms:3000
ENV CMS_URL=$CMS_URL
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
RUN bun install
COPY apps/web/ apps/web/
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:latest AS runner
WORKDIR /app
COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV HOST=0.0.0.0 PORT=80
EXPOSE 80
CMD ["bun", "dist/server/entry.mjs"]
