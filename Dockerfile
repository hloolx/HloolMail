FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /app/web
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY
COPY web/package.json web/package-lock.json ./
COPY web/scripts ./scripts
RUN npm ci
RUN node scripts/install-native-build-deps.cjs
COPY web ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS api
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
ARG GOPROXY=https://proxy.golang.org|https://goproxy.cn|direct
ENV GOPROXY=$GOPROXY
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
COPY --from=web /app/web/dist ./internal/frontend/dist
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -tags embed_frontend -trimpath -ldflags="-s -w -X gptmail/internal/version.Version=${VERSION} -X gptmail/internal/version.Commit=${COMMIT} -X gptmail/internal/version.BuildTime=${BUILD_TIME}" -o /out/hloolmail ./cmd/server

FROM alpine:3.21
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=api /out/hloolmail /usr/local/bin/hloolmail
RUN mkdir -p /app/storage && chown -R app:app /app
USER app
ENV HTTP_ADDR=:3000 \
    SMTP_ADDR=:2525 \
    HLOOLMAIL_DEPLOYMENT=docker \
    DATABASE_DRIVER=sqlite \
    DATABASE_URL=/app/storage/hlool-mail.db
EXPOSE 3000 2525
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["hloolmail"]
