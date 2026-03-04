import 'dotenv/config';

export const auth = {
  jwtSecret: process.env.STELLAR_AUTH_JWT_SECRET
};

export const logging = {
  level: process.env.STELLAR_LOG_LEVEL || 'info',
  timestampFormat: process.env.STELLAR_LOG_TIME_FMT
};

export const mongo = {
  uri: process.env.STELLAR_MONGO_URI
};

export const http = {
  port: parseInt(process.env.STELLAR_HTTP_PORT || '8080', 10),
  corsOrigin: process.env.STELLAR_HTTP_CORS_ORIGIN
};

export const bigcommerce = {
  clientId: process.env.STELLAR_BC_CLIENT_ID,
  accessToken: process.env.STELLAR_BC_ACCESS_TOKEN,
  storeHash: process.env.STELLAR_BC_STORE_HASH,
  storefrontToken: process.env.STELLAR_BC_STOREFRONT_TOKEN,
  graphqlUrl: process.env.STELLAR_BC_STORE_HASH
    ? `https://store-${process.env.STELLAR_BC_STORE_HASH}.mybigcommerce.com/graphql`
    : ''
};
