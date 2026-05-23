FROM oven/bun:latest AS build
WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
RUN bun install
COPY apps/web/ apps/web/
WORKDIR /app/apps/web
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
