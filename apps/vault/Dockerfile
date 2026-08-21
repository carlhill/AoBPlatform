# syntax=docker/dockerfile:1.7
# Build context is the MONOREPO ROOT (this service depends on workspace
# packages). See CONVENTIONS.md §8.
#   docker build -f apps/vault/Dockerfile -t aobplatform/vault .

FROM node:20-alpine AS builder
WORKDIR /workspace
# package.json-first so only dependency changes invalidate the install layer.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/vault-client/package.json packages/vault-client/package.json
COPY apps/vault/package.json apps/vault/package.json
COPY certs ./certs
# Machines behind a TLS-inspecting proxy/antivirus drop a root CA at
# certs/local-ca.pem (gitignored; Node warns and continues when absent).
# npm@11 avoids the npm 10.8.x exit-handler crash on large workspace installs.
ENV NODE_EXTRA_CA_CERTS=/workspace/certs/local-ca.pem
RUN npm install -g npm@11 && \
    npm install --workspaces --include-workspace-root
COPY . .
# The vault has its OWN Prisma client (workspace-local output) for the
# chain-entry index — generate it before tsc.
RUN npm run prisma:generate -w apps/vault
RUN npm run build -w packages/domain -w packages/contracts -w apps/vault

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
EXPOSE 3003
# Probe 127.0.0.1, never localhost (::1 vs IPv4-only listener).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3003/health || exit 1
CMD ["node", "apps/vault/dist/main.js"]
