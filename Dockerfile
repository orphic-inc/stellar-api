# Build stage
FROM node:lts-alpine AS build
WORKDIR /usr/src/stellar-api
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:lts-alpine
WORKDIR /usr/src/stellar-api
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /usr/src/stellar-api/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /usr/src/stellar-api/dist ./dist
COPY prisma ./prisma
EXPOSE 8080
CMD ["node", "dist/index.js"]
