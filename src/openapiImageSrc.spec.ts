/**
 * The contract declares each image field's `*Src` sibling by the rule the
 * response hook applies (#737 slice 3): on what a 2xx response returns, and
 * nowhere else.
 */
import { applyImageSrcDerivations } from './lib/openapiImageSrc';

const withImage = () => ({
  type: 'object',
  properties: { id: { type: 'number' }, avatar: { type: 'string' } },
  required: ['id', 'avatar']
});

const buildDoc = () => ({
  paths: {
    '/things': {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Returned' }
              }
            }
          },
          400: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorOnly' }
              }
            }
          }
        }
      },
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Sent' }
            }
          }
        },
        responses: { 204: { description: 'Done' } }
      }
    }
  },
  components: {
    schemas: {
      Returned: {
        type: 'object',
        properties: {
          author: withImage(),
          image: { type: 'string' },
          coverImages: { type: 'array', items: { type: 'string' } }
        }
      },
      ErrorOnly: withImage(),
      Sent: withImage()
    }
  }
});

it('declares a sibling on what a 2xx response returns, nested or not', () => {
  const doc = buildDoc();
  applyImageSrcDerivations(doc);
  const returned = doc.components.schemas.Returned as unknown as {
    properties: Record<string, { properties?: object; required?: string[] }>;
  };

  expect(returned.properties.imageSrc).toMatchObject({
    type: 'string',
    nullable: true
  });
  expect(returned.properties.author.properties).toHaveProperty('avatarSrc');
  expect(returned.properties.coverImagesSrc).toMatchObject({
    type: 'array',
    items: { type: 'string' }
  });
  // Required exactly where the raw field is, since the hook always adds it.
  expect(returned.properties.author.required).toEqual([
    'id',
    'avatar',
    'avatarSrc'
  ]);
});

it('leaves request bodies and error bodies alone', () => {
  const doc = buildDoc();
  applyImageSrcDerivations(doc);

  expect(doc.components.schemas.Sent).toEqual(withImage());
  expect(doc.components.schemas.ErrorOnly).toEqual(withImage());
});
