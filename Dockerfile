# ────────────────────────────────────────────────────────────────
# Stage 1 — build
#   Install all deps and compile the Next.js app in standalone mode.
#   The installer and all source files never reach the final image.
# ────────────────────────────────────────────────────────────────
# node:20-alpine — pinned to a specific digest for supply-chain integrity.
# To update: run `docker pull node:20-alpine` and replace the digest below,
# or let Dependabot/Renovate open a PR when a new digest is published.
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS build

# Required for Next.js SWC binaries on Alpine (glibc compat shim)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifests first — dependency layer is cached independently of source
COPY package.json package-lock.json ./

# Exact versions from lock file; --ignore-scripts limits attack surface
RUN npm ci --ignore-scripts

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# GROQ_API_KEY is runtime-only — not consumed by next build

RUN npm run build


# ────────────────────────────────────────────────────────────────
# Stage 2 — runner  (final image)
#   Uses only the standalone bundle — no source, no dev deps.
#   Runs as a non-root user to follow least-privilege principle.
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7001
ENV HOSTNAME=0.0.0.0

# Create a non-root user/group
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server and the static assets produced by the build
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public           ./public

USER nextjs

EXPOSE 7001

# Health-check via Node's built-in http — no extra binaries needed
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:7001/',r=>{process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
