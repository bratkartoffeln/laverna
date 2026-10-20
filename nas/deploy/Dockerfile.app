FROM node:24.14.0-bookworm-slim
ARG LAVERNA_REVISION=development
ENV NODE_ENV=production PORT=3000 LAVERNA_REVISION=$LAVERNA_REVISION
LABEL org.opencontainers.image.source=https://github.com/bratkartoffeln/laverna org.opencontainers.image.revision=$LAVERNA_REVISION
WORKDIR /app
COPY server ./server
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/main.mjs"]
