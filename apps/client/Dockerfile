# Next.js (SSR) on Cloud Run — turbo prune standalone multi-stage build
# Stage 0: Prune monorepo for client
FROM oven/bun:1.3.9 AS pruner
WORKDIR /app
RUN bun add --global turbo@2
COPY . .
RUN turbo prune client --docker

# Stage 1: Install dependencies & build
FROM oven/bun:1.3.9 AS builder
WORKDIR /app

# Install from pruned lockfile + package.json manifests (maximise cache)
COPY --from=pruner /app/out/json/ .
RUN bun install --ignore-scripts

# Copy full source from pruned output
COPY --from=pruner /app/out/full/ .

# Generate Prisma Client (required by api-service type declarations)
WORKDIR /app/packages/database
RUN bun run db:generate

# Generate api-service type declarations (dist/app.d.ts) required by the client
WORKDIR /app/apps/api-service
RUN bun run build:types

# Build Next.js app (output: "standalone")
WORKDIR /app/apps/client
RUN bun run build

# Stage 2: Production runtime (minimal image)
FROM oven/bun:1.3.9-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Copy standalone server (includes all required node_modules)
COPY --from=builder /app/apps/client/.next/standalone ./
# Copy static assets and public files
COPY --from=builder /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=builder /app/apps/client/public ./apps/client/public

USER nextjs

CMD ["bun", "apps/client/server.js"]
