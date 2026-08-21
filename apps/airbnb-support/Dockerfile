FROM node:22-bookworm-slim

WORKDIR /workspace
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Africa/Johannesburg \
    AIRBNB_SERVICE_NAME=airbnb-support

COPY packages/airbnb-core ./packages/airbnb-core
COPY packages/airbnb-db ./packages/airbnb-db
COPY apps/airbnb-support/package.json apps/airbnb-support/package-lock.json ./apps/airbnb-support/

WORKDIR /workspace/apps/airbnb-support
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY apps/airbnb-support/*.mjs ./

EXPOSE 3000
CMD ["node", "server.mjs"]
