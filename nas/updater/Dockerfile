FROM node:24.14.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /updater
COPY core.mjs main.mjs ./
CMD ["node", "main.mjs"]
