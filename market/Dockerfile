# Marketplace API. Build from the repository root:
#   docker build -f market/Dockerfile -t wingfoil-market-api .
# Railway: set the service's Dockerfile path to market/Dockerfile.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY market/ ./market/
RUN npx tsc -p market/api/tsconfig.json

FROM node:22-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && groupadd --gid 10001 market \
    && useradd --uid 10001 --gid 10001 --no-create-home market \
    && mkdir -p /data && chown 10001:10001 /data
COPY --from=build /app/market/api/dist ./market/api/dist
COPY market/api/migrations ./market/api/migrations
USER 10001:10001
EXPOSE 8787
# Only used with MARKET_STORAGE=local; mount a volume here.
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/market/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "market/api/dist/api/src/index.js"]
