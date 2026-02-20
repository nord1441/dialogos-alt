FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY --from=builder /app/dist ./dist
COPY public/ ./public/

RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "dist/server.js"]
