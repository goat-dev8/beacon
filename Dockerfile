# Beacon API — production image for Render
# Runtime uses tsx against TypeScript sources (package.json exports point at src).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=10000

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/x402/package.json packages/x402/
COPY packages/quote/package.json packages/quote/
COPY packages/acceptance/package.json packages/acceptance/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/receipts/package.json packages/receipts/
COPY packages/fdc/package.json packages/fdc/
COPY packages/smart-accounts/package.json packages/smart-accounts/
COPY packages/mcp/package.json packages/mcp/
COPY services/orchestrator/package.json services/orchestrator/
COPY services/settler/package.json services/settler/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/api ./apps/api

EXPOSE 10000
CMD ["npx", "tsx", "apps/api/src/index.ts"]
