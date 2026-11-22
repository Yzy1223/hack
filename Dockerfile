FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --no-audit --no-fund
COPY backend/ backend/
COPY frontend/ frontend/
COPY shared/ shared/
RUN npm run build && ./node_modules/.bin/tsc -p backend/tsconfig.json --noEmit false --rootDir . --outDir /compiled
RUN npm prune --omit=dev --workspace=backend --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production WORKBENCH_CONTAINER=1 PORT=4310 CATALOG_PATH=/app/catalog
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /compiled/backend/src ./backend/src
COPY backend/package.json ./backend/package.json
COPY backend/resources/ ./backend/resources/
COPY --from=build /app/frontend/dist ./frontend/dist
COPY catalog/ ./catalog/
RUN mkdir -p /app/backend/data && chown node:node /app/backend/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s CMD node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","backend/src/server.js"]
