FROM oven/bun:1.4.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) export BUN_COMPILE_TARGET=bun-linux-x64-musl ;; \
      arm64) export BUN_COMPILE_TARGET=bun-linux-arm64-musl ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && bun run build

FROM alpine:3.22 AS runtime
RUN apk add --no-cache libstdc++ \
    && addgroup -S twitchmock && adduser -S -G twitchmock twitchmock \
    && mkdir -p /data && chown twitchmock:twitchmock /data
ENV SQLITE_PATH=/data/twitch-mock.sqlite
COPY --from=build /app/dist/twitch-mock /usr/local/bin/twitch-mock
USER twitchmock
EXPOSE 3333 7777 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD addr="${HTTP_ADDR:-${PORT:-7777}}"; wget -q -O /dev/null "http://127.0.0.1:${addr##*:}/health" || exit 1
ENTRYPOINT ["twitch-mock"]
