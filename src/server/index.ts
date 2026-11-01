import index from '../client/index.html';
import { Storage } from './storage';
import { Core, id, now } from './core';
import { admin } from './admin';
import { api } from './helix';

export interface Options {
  httpAddr?: string;
  wsAddr?: string;
  adminAddr?: string;
  siteBaseURL?: string;
  storage?: 'memory' | 'sqlite';
  sqlitePath?: string;
}

function address(value: string) {
  const separator = value.lastIndexOf(':');

  if (separator < 0) return { port: Number(value) };
  const host = value.slice(0, separator).replace(/^\[|\]$/g, '');

  return { port: Number(value.slice(separator + 1)), ...(host ? { hostname: host } : {}) };
}

export function start(options: Options = {}) {
  const storage = new Storage(options.storage, options.sqlitePath);
  const core = new Core(storage);
  const servers: ReturnType<typeof Bun.serve>[] = [];
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  try {
    const http = Bun.serve({
      ...address(options.httpAddr ?? process.env.HTTP_ADDR ?? ':7777'),
      fetch: (request) =>
        api(
          core,
          request,
          options.siteBaseURL ?? process.env.SITE_BASE_URL ?? 'http://localhost:3005',
        ),
    });

    servers.push(http);

    const ws = Bun.serve<{ sessionId: string }>({
      ...address(options.wsAddr ?? process.env.WS_ADDR ?? ':8081'),
      fetch(request, server) {
        if (
          new URL(request.url).pathname === '/ws' &&
          server.upgrade(request, { data: { sessionId: id() } })
        )
          return;

        return new Response('Not Found', { status: 404 });
      },
      websocket: {
        open(socket) {
          const sessionId = socket.data.sessionId;
          core.sockets.set(sessionId, socket);
          socket.send(
            JSON.stringify({
              metadata: {
                message_id: id(),
                message_type: 'session_welcome',
                message_timestamp: now(),
              },
              payload: {
                session: {
                  id: sessionId,
                  status: 'connected',
                  keepalive_timeout_seconds: 30,
                  reconnect_url: null,
                  connected_at: now(),
                },
              },
            }),
          );
          timers.set(
            sessionId,
            setInterval(
              () =>
                socket.send(
                  JSON.stringify({
                    metadata: {
                      message_id: id(),
                      message_type: 'session_keepalive',
                      message_timestamp: now(),
                    },
                    payload: {},
                  }),
                ),
              25000,
            ),
          );
        },
        message() {},
        close(socket) {
          core.sockets.delete(socket.data.sessionId);
          const timer = timers.get(socket.data.sessionId);

          if (timer) clearInterval(timer);
          timers.delete(socket.data.sessionId);
        },
      },
    });

    servers.push(ws);

    const control = Bun.serve({
      ...address(options.adminAddr ?? process.env.ADMIN_ADDR ?? ':3333'),
      idleTimeout: 0,
      routes: { '/admin': index, '/admin/chat': index },
      fetch: (request) => admin(core, request),
      development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
    });

    servers.push(control);

    return {
      core,
      http,
      ws,
      admin: control,
      stop() {
        for (const timer of timers.values()) clearInterval(timer);
        timers.clear();

        for (const server of servers) server.stop(true);
        storage.close();
      },
    };
  } catch (error) {
    for (const server of servers) server.stop(true);
    storage.close();
    throw error;
  }
}

if (import.meta.main) {
  const app = start();
  console.log(
    `TwitchMock: API ${app.http.url} · EventSub ${app.ws.url}ws · admin ${app.admin.url}admin`,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      app.stop();
      process.exit(0);
    });
}
