import { bigcommerce } from './config.js';
import { getLogger } from './logging.js';

const log = getLogger('bigcommerce');

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function graphqlStorefront<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!bigcommerce.graphqlUrl) {
    throw new Error('BigCommerce store hash is not configured');
  }

  const token = bigcommerce.storefrontToken;
  if (!token) {
    throw new Error('BigCommerce storefront token is not configured');
  }

  const response = await fetch(bigcommerce.graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    log.error(`BigCommerce GraphQL request failed: ${response.status}`);
    throw new Error(`BigCommerce API error: ${response.status}`);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors?.length) {
    log.error(`BigCommerce GraphQL errors: ${JSON.stringify(result.errors)}`);
    throw new Error(result.errors[0].message);
  }

  return result.data as T;
}

/**
 * Create a storefront API token using the BigCommerce Management API.
 * Requires STELLAR_BC_ACCESS_TOKEN and STELLAR_BC_CLIENT_ID.
 */
export async function createStorefrontToken(
  channelId: number = 1,
  expiresInSeconds: number = 86400
): Promise<string> {
  if (!bigcommerce.storeHash || !bigcommerce.accessToken) {
    throw new Error(
      'BigCommerce store hash and access token are required to create a storefront token'
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  const response = await fetch(
    `https://api.bigcommerce.com/stores/${bigcommerce.storeHash}/v3/storefront/api-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': bigcommerce.accessToken
      },
      body: JSON.stringify({
        channel_id: channelId,
        expires_at: expiresAt,
        allowed_cors_origins: []
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    log.error(`Failed to create storefront token: ${response.status} ${text}`);
    throw new Error(`Failed to create storefront token: ${response.status}`);
  }

  const result = await response.json();
  return result.data?.token;
}
