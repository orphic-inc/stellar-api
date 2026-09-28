/**
 * Declares the `*Src` sibling of every image field a response carries (#737
 * slice 3, ADR-0051), by the rule `middleware/imageSrc.ts` applies at runtime:
 * wherever a response object has `avatar`, `image`, `customIcon` or
 * `secondAvatar`, it also has that key plus `Src`, a nullable string.
 *
 * Derived on the generated document, like the gate responses, rather than
 * written into each of the ~27 schemas: the hook adds the sibling to every
 * response without being asked, so the contract should too. Only schemas a 2xx
 * response reaches are touched, so a request body never gains one.
 */
import { IMAGE_FIELDS, srcKey } from '../modules/imageSrc';

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const SRC_SCHEMA = {
  type: 'string',
  nullable: true,
  description:
    'What a browser may load for the image field beside it: a path on this origin (an imported or uploaded image is /api/asset/<hash>), or null while a remote image is not imported. Never a remote URL (ADR-0051).'
};

/** Add the siblings to one object schema's own properties. */
function declareSiblings(schema: Node): void {
  const props = schema.properties;
  if (!isNode(props)) return;
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : null;
  for (const field of IMAGE_FIELDS) {
    if (!(field in props) || srcKey(field) in props) continue;
    props[srcKey(field)] = { ...SRC_SCHEMA };
    if (required?.includes(field)) required.push(srcKey(field));
  }
}

/**
 * Visit every schema under `node`, following `$ref`s into `schemas` once each.
 * Declares siblings on each object schema it meets.
 */
function visit(node: unknown, schemas: Node, seen: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, schemas, seen));
    return;
  }
  if (!isNode(node)) return;
  const ref = node.$ref;
  if (typeof ref === 'string') {
    const name = ref.split('/').pop() ?? '';
    if (seen.has(name)) return;
    seen.add(name);
    visit(schemas[name], schemas, seen);
    return;
  }
  declareSiblings(node);
  Object.values(node).forEach((child) => visit(child, schemas, seen));
}

/** Declare the image `*Src` siblings on everything a 2xx response returns. */
export function applyImageSrcDerivations(doc: {
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
}): void {
  const schemas = (doc.components?.schemas ?? {}) as Node;
  const seen = new Set<string>();
  for (const pathItem of Object.values(doc.paths ?? {})) {
    if (!isNode(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (!isNode(operation) || !isNode(operation.responses)) continue;
      for (const [code, response] of Object.entries(operation.responses)) {
        if (code.startsWith('2')) visit(response, schemas, seen);
      }
    }
  }
}
