FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY public ./public
COPY src ./src

RUN mkdir -p /app/data/files && chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ready').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

USER node
CMD ["node", "src/server.js"]
