FROM node:24.14.0-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY nas/package*.json ./nas/
RUN npm ci --prefix nas --ignore-scripts --omit=dev
COPY package.json ./
COPY nas/build.js nas/vendor-lock.json ./nas/
RUN node nas/build.js --dependencies-only
COPY . .
ARG LAVERNA_REVISION=development
RUN LAVERNA_REVISION=$LAVERNA_REVISION node nas/build.js --web-only
FROM node:24.14.0-bookworm-slim
ARG LAVERNA_REVISION=development
ENV NODE_ENV=production PORT=3000 LAVERNA_REVISION=$LAVERNA_REVISION
LABEL org.opencontainers.image.source=https://github.com/bratkartoffeln/laverna org.opencontainers.image.revision=$LAVERNA_REVISION
WORKDIR /app
COPY --from=builder /source/release/laverna-nas/server ./server
COPY --from=builder /source/release/laverna-nas/web ./web
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/main.mjs"]
