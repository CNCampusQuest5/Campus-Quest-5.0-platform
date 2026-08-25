# ==========================================
# Phase 1: Build Workspace
# ==========================================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for compiling native node modules if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root configurations and lockfiles
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/admin/package.json ./apps/admin/
COPY apps/electron/package.json ./apps/electron/
COPY packages/shared/package.json ./packages/shared/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies for all monorepo workspaces
RUN npm ci

# Copy full source tree
COPY . .

# Run production build for the backend package
RUN npx turbo run build --filter=@campus-quest/backend

# Prune dev dependencies to make final image lightweight
RUN npm prune --omit=dev

# ==========================================
# Phase 2: Production Execution Environment
# ==========================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install required compilers & runtimes for the sandbox execution engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    openjdk-17-jdk-headless \
    python3 \
    python3-minimal \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and node_modules from builder phase
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/backend/drizzle ./apps/backend/drizzle

# Copy problems data so it is bundled in the Docker image
COPY problems ./problems

# Set production env flags
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV PROBLEMS_DIR=/app/problems

EXPOSE 3001

# Run backend API & Worker hybrid process
CMD ["node", "apps/backend/dist/index.js"]
