# Beacon API — production image for Render
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/x402/package.json packages/x402/
COPY packages/quote/package.json packages/quote/
COPY packages/acceptance/package.json packages/acceptance/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/receipts/package.json packages/receipts/
COPY packages/fdc/package.json packages/fdc/
COPY packages/smart-accounts/package.json packages/smart-accounts/
COPY services/orchestrator/package.json services/orchestrator/
COPY services/settler/package.json services/settler/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY . .
RUN npm ci && npm run build --workspaces --if-present

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3001
COPY --from=build /app /app
EXPOSE 3001
CMD ["npx", "tsx", "apps/api/src/index.ts"]
