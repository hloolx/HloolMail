FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /app/web
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY
COPY web/package.json web/package-lock.json ./
COPY web/scripts ./scripts
RUN npm install
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
COPY --from=web /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/hloolmail ./cmd/server

FROM alpine:3.21
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=api /out/hloolmail /usr/local/bin/hloolmail
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /app/storage && chown -R app:app /app
USER app
ENV HTTP_ADDR=:3000 \
    SMTP_ADDR=:2525 \
    FRONTEND_DIST=/app/web/dist \
    HLOOLMAIL_DEPLOYMENT=docker \
    DATABASE_DRIVER=sqlite \
    DATABASE_URL=/app/storage/gptmail.db
EXPOSE 3000 2525
CMD ["hloolmail"]
