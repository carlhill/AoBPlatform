# syntax=docker/dockerfile:1.7
# Build context is the MONOREPO ROOT. See CONVENTIONS.md §8.
#   docker build -f apps/core/Dockerfile -t aobplatform/core .

FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/vault-client/package.json packages/vault-client/package.json
COPY packages/auth-client/package.json packages/auth-client/package.json
COPY apps/connector/package.json apps/connector/package.json
COPY apps/core/package.json apps/core/package.json
COPY certs ./certs
ENV NODE_EXTRA_CA_CERTS=/workspace/certs/local-ca.pem
RUN npm install -g npm@11 && \
    npm install --workspaces --include-workspace-root
COPY . .
# PrismaService needs the generated client before tsc can build (pre-flight
# checklist item 2 — package.json has prisma:generate, so the Dockerfile
# MUST run it).
RUN npm run prisma:generate -w apps/core
# Order matters: the connector must build before core, which imports it.
RUN npm run build -w packages/domain -w packages/contracts -w packages/vault-client -w packages/auth-client && \
    npm run build -w apps/connector && \
    npm run build -w apps/core

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "apps/core/dist/main.js"]
