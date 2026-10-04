FROM node:22-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./

RUN npm install --omit=dev

COPY dist ./dist

ENV NODE_ENV=production \
    PORT=3001 \
    NODE_OPTIONS="--max-old-space-size=2048"

RUN mkdir -p /app/storage/raw /app/storage/processed /app/cache/content && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').request('http://localhost:' + (process.env.PORT || 3001) + '/health/live', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).end()"

CMD ["node", "dist/index.js"]
