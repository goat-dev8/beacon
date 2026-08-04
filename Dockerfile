# Beacon API — production image for Render
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci \
  && npm run build -w @beacon/shared \
  && npm run build -w @beacon/x402 \
  && npm run build -w @beacon/quote \
  && npm run build -w @beacon/acceptance \
  && npm run build -w @beacon/pipeline \
  && npm run build -w @beacon/receipts \
  && npm run build -w @beacon/fdc \
  && npm run build -w @beacon/smart-accounts

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=10000
COPY --from=build /app /app
EXPOSE 10000
CMD ["npx", "tsx", "apps/api/src/index.ts"]
