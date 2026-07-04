# Pinned (was floating node:lts-alpine, which drifted to Alpine 3.23 and broke the
# Prisma OpenSSL engine — see orphic-inc/stellar-api#99). Node 24 LTS + Alpine 3.23.
FROM node:24-alpine3.23 AS build

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci

COPY . .
# Client only: the ERD generator (prisma-erd-generator) is a devDependency and the
# image needs just @prisma/client. A bare `prisma generate` runs every generator,
# which breaks the runtime stage below (--omit=dev has no erd binary to resolve).
RUN npx prisma generate --generator client
RUN npm run build

FROM node:24-alpine3.23

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/stellar-api/dist ./dist
COPY --from=build /usr/src/stellar-api/prisma ./prisma
COPY --chmod=0755 docker-entrypoint.sh ./docker-entrypoint.sh

# Client only — devDependencies (incl. prisma-erd-generator) are omitted here.
# The `prisma` CLI itself is a runtime dependency (not devDep) so the entrypoint
# can run `migrate deploy` offline against the target DB.
RUN npx prisma generate --generator client

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Self-migrating: apply pending migrations, then start. See docker-entrypoint.sh.
CMD ["./docker-entrypoint.sh"]
