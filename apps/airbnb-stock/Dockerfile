FROM node:22-bookworm-slim

WORKDIR /workspace
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Africa/Johannesburg \
    AIRBNB_SERVICE_NAME=airbnb-stock

COPY packages/airbnb-core ./packages/airbnb-core
COPY packages/airbnb-db ./packages/airbnb-db
COPY apps/airbnb-stock/package.json apps/airbnb-stock/package-lock.json ./apps/airbnb-stock/

WORKDIR /workspace/apps/airbnb-stock
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY apps/airbnb-stock/*.mjs ./

EXPOSE 3000
CMD ["node", "server.mjs"]
