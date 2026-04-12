# ────────────────────────────────────────────────────────────────
# Stage 1 — deps
#   Install production + dev deps with the lock file so the
#   build stage gets an exact, reproducible dependency tree.
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# Required for some native npm packages (e.g. sharp)
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./

# ci installs exact versions from lock file; --ignore-scripts limits attack surface
RUN npm ci --ignore-scripts


# ────────────────────────────────────────────────────────────────
# Stage 2 — builder
#   Compile the Next.js app in standalone mode, which produces a
#   self-contained server bundle in .next/standalone with only
#   the node_modules it actually needs at runtime.
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY . .

# Build-time env placeholder ensures Next.js doesn't complain about
# missing vars during the build; real values are injected at runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ────────────────────────────────────────────────────────────────
# Stage 3 — runner  (final image)
#   Uses only the standalone bundle — no source, no dev deps.
#   Runs as a non-root user to follow least-privilege principle.
# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7001
ENV HOSTNAME=0.0.0.0

# Create a non-root user/group
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy the standalone server and the static assets produced by the build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

USER nextjs

EXPOSE 7001

# Health-check: ping the root page every 30 s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:7001/ || exit 1

# next/standalone outputs a server.js at the project root
CMD ["node", "server.js"]
