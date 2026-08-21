# syntax=docker/dockerfile:1.7
# Build context is the MONOREPO ROOT. See CONVENTIONS.md §8.
#   docker build -f apps/web/Dockerfile -t aobplatform/web .

FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/vault-client/package.json packages/vault-client/package.json
COPY packages/auth-client/package.json packages/auth-client/package.json
COPY apps/web/package.json apps/web/package.json
COPY certs ./certs
ENV NODE_EXTRA_CA_CERTS=/workspace/certs/local-ca.pem
RUN npm install -g npm@11 && \
    npm install --workspaces --include-workspace-root
COPY . .
# NEXT_PUBLIC_* are inlined AT BUILD TIME, so the browser-facing URLs must be
# baked here. These are the host-mapped ports the BROWSER reaches — never the
# container-internal names, which a browser cannot resolve.
ENV NEXT_PUBLIC_CORE_URL=http://localhost:21001 \
    NEXT_PUBLIC_RULES_URL=http://localhost:21002 \
    NEXT_PUBLIC_VAULT_URL=http://localhost:21003 \
    NEXT_PUBLIC_KEYCLOAK_ISSUER=http://localhost:21024/realms/aobplatform \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=web
# LOCAL IMAGE ONLY, and a separate ENV so the comment cannot end up inside a
# value (it did, the first time: a comment inside a backslash continuation is
# not a comment, it is part of the string).
#
# This offers a "continue without signing in" button on the console gate. It
# exists because the passkey ceremony is unproven on real hardware — without
# it, a browser that cannot complete WebAuthn locks you out of the very
# screens used to invite someone to enrol a passkey. A production build must
# not set this, and the gate then has no bypass at all.
ENV NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE=true
RUN npm run build -w packages/domain -w packages/contracts && \
    npm run build -w apps/web

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3100 || exit 1
CMD ["npm", "run", "start", "-w", "apps/web"]
