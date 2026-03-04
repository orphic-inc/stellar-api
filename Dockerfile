FROM node:lts-alpine

WORKDIR /usr/src/stellar-api

COPY . .

RUN npm ci

EXPOSE 4056

CMD ["node", "src/index.js"]
