FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
EXPOSE 80
CMD ["bun", "run", "preview", "--host", "0.0.0.0", "--port", "80"]