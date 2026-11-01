import { expect, test } from 'bun:test';
import { start } from '../../src/server';

test('HTTP listen address honors PORT and explicit overrides', async () => {
  const originalPort = process.env.PORT;
  const originalAddress = process.env.HTTP_ADDR;
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  reservation.stop(true);
  let app: ReturnType<typeof start> | undefined;
  const options = { wsAddr: '127.0.0.1:0', adminAddr: '127.0.0.1:0', storage: 'memory' } as const;

  try {
    delete process.env.HTTP_ADDR;
    process.env.PORT = String(port);
    app = start(options);
    expect(app.http.port).toBe(port);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    app.stop();
    app = undefined;

    process.env.PORT = 'not-a-port';
    process.env.HTTP_ADDR = '127.0.0.1:0';
    app = start(options);
    expect(app.http.hostname).toBe('127.0.0.1');
    expect((await fetch(new URL('/health', app.http.url))).status).toBe(200);
    app.stop();
    app = undefined;

    process.env.HTTP_ADDR = 'not-an-address';
    app = start({ ...options, httpAddr: '127.0.0.1:0' });
    expect(app.http.hostname).toBe('127.0.0.1');
    expect((await fetch(new URL('/health', app.http.url))).status).toBe(200);
  } finally {
    app?.stop();

    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;

    if (originalAddress === undefined) delete process.env.HTTP_ADDR;
    else process.env.HTTP_ADDR = originalAddress;
  }
});
