# TwitchMock

A standalone Twitch API mock for developing and testing Twir and other Twitch integrations. It provides a browser control panel, OAuth and Helix endpoints, EventSub over WebSocket, and a simulated chat. State is held in memory by default; optional SQLite storage keeps it across restarts.

## Getting started

Prerequisites: [Bun](https://bun.com/) 1.4.4 (pinned in `.bun-version`) or Docker with Compose.

```sh
bun install --frozen-lockfile
bun run dev
```

Open [the control panel](http://localhost:3333/admin) or [chat](http://localhost:3333/admin/chat). The OAuth and Helix API listens on port **7777**, and EventSub WebSockets on **8081** (`ws://localhost:8081/ws`).

Build a native, self-contained executable for the current platform and run it:

```sh
bun run build
bun run start
# or: ./dist/twitch-mock
```

The binary includes the Bun runtime, browser assets, and SQLite support; it does not require Bun, `node_modules`, or adjacent assets at runtime. Its native system libraries must be available. The binary uses the current working directory for relative paths such as the default SQLite database. Build again on the target platform when a different architecture or OS is needed.

## Docker

```sh
docker compose up --build -d
```

The default uses in-memory storage. To persist state between restarts using SQLite, enable it before starting the container:

```sh
STORAGE=sqlite docker compose up --build -d
```

To use a different OAuth and Helix port, set `PORT` before starting Compose:

```sh
PORT=7778 docker compose up --build -d
```

This maps port `7778` on the host to port `7778` in the container. Update Twir's mock API and auth URLs to use the same port.

Compose mounts the `twitch-mock-data` volume at `/data`; the database and its associated SQLite files live there. To use a different OAuth redirect base, set `SITE_BASE_URL` in the environment before starting Compose. `docker compose down` preserves the volume; `docker compose down -v` removes it and the saved state.

To run an image from GitHub Container Registry instead:

```sh
docker run --rm -p 3333:3333 -p 7777:7777 -p 8081:8081 ghcr.io/satont/twitch-mock:latest
```

The GitHub Actions workflow for `Satont/twitch-mock` runs checks on pull requests and publishes a Docker image for pushes to `main` and version tags (`v*`). Published images use `latest` for `main`, a commit SHA tag, and version tags for releases. The image's visibility follows GitHub's package settings. Publishing requires the repository's Actions token to have package write access.

## Configuration

| Variable        | Default                     | Purpose                                                                                     |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`          | `7777`                      | OAuth and Helix port; health endpoint is `GET /health`.                                     |
| `HTTP_ADDR`     | unset                       | Full OAuth and Helix listen address; takes precedence over `PORT`.                          |
| `WS_ADDR`       | `:8081`                     | EventSub WebSocket listen address; path `/ws`.                                              |
| `ADMIN_ADDR`    | `:3333`                     | Control panel and admin API listen address.                                                 |
| `SITE_BASE_URL` | `http://localhost:3005`     | Twir site base URL for the mock OAuth redirect.                                             |
| `STORAGE`       | `memory`                    | `memory` for ephemeral state or `sqlite` for persistent state.                              |
| `SQLITE_PATH`   | `./data/twitch-mock.sqlite` | Path to the SQLite database when `STORAGE=sqlite`; Compose uses `/data/twitch-mock.sqlite`. |

An explicit `start({ httpAddr })` option takes precedence over `HTTP_ADDR`; `HTTP_ADDR` takes precedence over `PORT`.

For SQLite, ensure the database's parent directory is writable and persist the **directory**, not just the database file: SQLite may create adjacent journal files. Live WebSocket and SSE connections are not persisted and must reconnect after a restart.

### Twir integration

Twir's `.env.mock.example` contains the complete integration configuration. When Twir and the mock run on the same host, the relevant values are:

```dotenv
TWITCH_MOCK_ENABLED=true
TWITCH_MOCK_API_URL=http://localhost:7777/helix
TWITCH_MOCK_AUTH_URL=http://localhost:7777
TWITCH_MOCK_WS_URL=ws://localhost:8081/ws
BOT_ACCESS_TOKEN=mock-bot-token
BOT_REFRESH_TOKEN=mock-bot-refresh-token
```

Use container service names instead of `localhost` when connecting from a different container. The seeded broadcaster is `12345` / `mockstreamer`; the bot is `67890` / `mockbot`.

## Development

```sh
bun check
bun run lint
bun fmt --check
bun test
bun run build
```

Use `bun fmt` to format files according to `.oxfmtrc.json`; generated JSON catalogs and reference fixtures are excluded. `bun run typecheck`, `bun run format`, and `bun run format:check` provide script aliases for the built-in commands. Run `bun run lint:fix` for available Oxlint fixes.

Oxlint includes eight structural rules from the vendored [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) plugin. Its remaining type-policy rules are intentionally disabled because Twitch payloads cross dynamic JSON boundaries; see `oxlint.config.ts` for the enabled rules.

The interface is built with React and Tailwind using Bun's HTML imports and built-in bundler. HTTP, WebSocket, tests and SQLite use Bun APIs. The mock is a development tool: the admin UI and API have no authentication. Do not expose it to an untrusted network without access controls.

## License and attribution

The root [LICENSE](LICENSE) is copied unchanged from Twir (CC BY-NC-ND 4.0). TwitchMock derives its behavior and reference catalog from Twir’s `apps/twitch-mock`. Vendored anti-slop tooling uses the MIT License, and bundled Noto Sans fonts use SIL OFL 1.1. See [NOTICE.md](NOTICE.md) for attribution and the corresponding license files.
