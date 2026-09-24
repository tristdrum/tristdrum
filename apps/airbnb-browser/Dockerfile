FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Africa/Johannesburg

WORKDIR /workspace/apps/airbnb-browser
COPY apps/airbnb-browser/package.json apps/airbnb-browser/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY apps/airbnb-browser/*.mjs ./

EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
