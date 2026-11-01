import { expect, test } from 'bun:test';
import catalog from '../../src/data/operations.json';
import fixture from '../fixtures/helix-go.json';
import { start } from '../../src/server';

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0])];

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, shape(item)]),
    );
  }

  return value === null ? 'null' : typeof value;
}

async function responseShape(response: Response): Promise<unknown> {
  const raw = await response.text();

  if (!raw) return 'empty';

  try {
    return shape(JSON.parse(raw));
  } catch {
    return shape(raw);
  }
}

test('Helix operations match the Go mock status and response shape', async () => {
  expect(catalog.operations).toHaveLength(149);
  expect(fixture.operations).toHaveLength(catalog.operations.length);

  const app = start({
    httpAddr: '127.0.0.1:0',
    wsAddr: '127.0.0.1:0',
    adminAddr: '127.0.0.1:0',
    storage: 'memory',
  });

  try {
    const mismatches: unknown[] = [];

    for (const [index, operation] of catalog.operations.entries()) {
      const expected = fixture.operations[index]!;
      const identifier = `${operation.method} ${operation.path} (${operation.slug})`;

      if (
        expected.slug !== operation.slug ||
        expected.method !== operation.method ||
        expected.path !== operation.path
      ) {
        throw new Error(`Fixture operation ${index} does not match catalog: ${identifier}`);
      }

      const request: RequestInit = {
        method: operation.method,
        headers: { 'content-type': 'application/json' },
      };

      if (!['GET', 'HEAD'].includes(operation.method))
        request.body = JSON.stringify(operation.request_body_example || {});
      const response = await fetch(new URL(operation.path, app.http.url), request);
      const actual = { status: response.status, shape: await responseShape(response) };
      const reference = { status: expected.status, shape: expected.shape };

      if (JSON.stringify(actual) !== JSON.stringify(reference))
        mismatches.push({ operation: identifier, expected: reference, actual });
    }

    expect(mismatches).toEqual([]);
  } finally {
    app.stop();
  }
}, 30_000);
