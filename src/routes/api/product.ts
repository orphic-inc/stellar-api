import express, { Request, Response } from 'express';
import { asyncHandler } from '../../modules/asyncHandler.js';
import { graphqlStorefront } from '../../modules/bigcommerce.js';

const router = express.Router();

const PRODUCTS_QUERY = `
  query GetProducts($first: Int, $after: String) {
    site {
      products(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            entityId
            name
            sku
            description
            path
            prices {
              price {
                value
                currencyCode
              }
            }
            images {
              edges {
                node {
                  urlOriginal
                  altText
                }
              }
            }
            brand {
              name
            }
            categories {
              edges {
                node {
                  name
                  path
                }
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query GetProduct($entityId: Int!) {
    site {
      product(entityId: $entityId) {
        entityId
        name
        sku
        description
        path
        prices {
          price {
            value
            currencyCode
          }
          salePrice {
            value
            currencyCode
          }
        }
        images {
          edges {
            node {
              urlOriginal
              altText
            }
          }
        }
        brand {
          name
        }
        categories {
          edges {
            node {
              name
              path
            }
          }
        }
        variants {
          edges {
            node {
              entityId
              sku
              defaultImage {
                urlOriginal
                altText
              }
              prices {
                price {
                  value
                  currencyCode
                }
              }
              options {
                edges {
                  node {
                    displayName
                    values {
                      edges {
                        node {
                          label
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($searchTerm: String!, $first: Int, $after: String) {
    site {
      search {
        searchProducts(filters: { searchTerm: $searchTerm }) {
          products(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                entityId
                name
                sku
                path
                prices {
                  price {
                    value
                    currencyCode
                  }
                }
                images {
                  edges {
                    node {
                      urlOriginal
                      altText
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// @route   GET /api/product
// @desc    Get all products from BigCommerce storefront
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const first = Math.min(parseInt(req.query.first as string) || 10, 50);
    const after = (req.query.after as string) || undefined;

    const data = await graphqlStorefront(PRODUCTS_QUERY, { first, after });

    const products = data.site.products.edges.map(
      (edge: { node: any }) => edge.node
    );
    const pageInfo = data.site.products.pageInfo;

    res.json({ products, pageInfo });
  })
);

// @route   GET /api/product/search
// @desc    Search products by term
router.get(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    const searchTerm = req.query.q as string;
    if (!searchTerm) {
      return res.status(400).json({ msg: 'Query parameter "q" is required' });
    }

    const first = Math.min(parseInt(req.query.first as string) || 10, 50);
    const after = (req.query.after as string) || undefined;

    const data = await graphqlStorefront(SEARCH_PRODUCTS_QUERY, {
      searchTerm,
      first,
      after
    });

    const searchResults = data.site.search.searchProducts.products;
    const products = searchResults.edges.map(
      (edge: { node: any }) => edge.node
    );
    const pageInfo = searchResults.pageInfo;

    res.json({ products, pageInfo });
  })
);

// @route   GET /api/product/:id
// @desc    Get single product by BigCommerce entity ID
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const entityId = parseInt(req.params.id);
    if (isNaN(entityId)) {
      return res.status(400).json({ msg: 'Invalid product ID' });
    }

    const data = await graphqlStorefront(PRODUCT_BY_ID_QUERY, { entityId });

    if (!data.site.product) {
      return res.status(404).json({ msg: 'Product not found' });
    }

    res.json(data.site.product);
  })
);

export default router;
