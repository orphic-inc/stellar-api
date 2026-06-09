# Pinned (was floating node:lts-alpine, which drifted to Alpine 3.23 and broke the
# Prisma OpenSSL engine — see orphic-inc/stellar-api#99). Node 24 LTS + Alpine 3.23.
FROM node:24-alpine3.23 AS build

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine3.23

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/stellar-api/dist ./dist
COPY --from=build /usr/src/stellar-api/prisma ./prisma

RUN npx prisma generate

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
