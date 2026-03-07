# Hono API on Cloud Run — turbo prune + single-binary build
# Stage 0: Prune monorepo for api-service
FROM oven/bun:1.3.9 AS pruner
WORKDIR /app
RUN bun add --global turbo@2
COPY . .
RUN turbo prune api-service --docker

# Stage 1: Install dependencies, generate Prisma, compile binary
FROM oven/bun:1.3.9 AS builder
WORKDIR /app

# Install from pruned lockfile + package.json manifests (maximise cache)
COPY --from=pruner /app/out/json/ .
RUN bun install --ignore-scripts

# Copy full source from pruned output
COPY --from=pruner /app/out/full/ .

# Generate Prisma Client for runtime
WORKDIR /app/packages/database
RUN bun run db:generate

# Compile single binary
WORKDIR /app
ARG TARGETARCH
RUN bun build --compile --minify \
    --target=bun-linux-$([ "$TARGETARCH" = "arm64" ] && echo "aarch64" || echo "x64") \
    --outfile=server \
    apps/api-service/src/index.ts

# Stage 2a: Migration runner (same approach as training-portal)
FROM oven/bun:1.3.9 AS migrate

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy hoisted node_modules (includes prisma CLI + engine binaries)
COPY --from=builder /app/node_modules ./node_modules

# Copy database package (prisma schema, migrations, package.json with scripts)
COPY --from=builder /app/packages/database ./packages/database

WORKDIR /app/packages/database

ENV NODE_ENV=production

CMD ["bun", "run", "db:deploy"]

# Stage 2b: Minimal runtime (no Bun required)
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN adduser --system --uid 1001 app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

COPY --from=builder /app/server ./server

USER app

CMD ["./server"]
