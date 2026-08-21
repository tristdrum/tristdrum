FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Africa/Johannesburg \
    AIRBNB_CLEANER_HOME=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY *.mjs ./
COPY fixtures ./fixtures
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.mjs"]
