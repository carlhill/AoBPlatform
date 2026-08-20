# syntax=docker/dockerfile:1.7
# Build context is the MONOREPO ROOT. See CONVENTIONS.md §8.
#   docker build -f apps/rules/Dockerfile -t aobplatform/rules .

FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/rules/package.json apps/rules/package.json
COPY certs ./certs
ENV NODE_EXTRA_CA_CERTS=/workspace/certs/local-ca.pem
RUN npm install -g npm@11 && \
    npm install --workspaces --include-workspace-root
COPY . .
RUN npm run build -w packages/domain -w packages/contracts -w apps/rules

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "apps/rules/dist/main.js"]
