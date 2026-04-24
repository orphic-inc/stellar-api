FROM node:lts-alpine AS build

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:lts-alpine

WORKDIR /usr/src/stellar-api

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /usr/src/stellar-api/dist ./dist
COPY --from=build /usr/src/stellar-api/prisma ./prisma

RUN npx prisma generate

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
