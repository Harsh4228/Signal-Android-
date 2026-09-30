# MeetMe relay server.
# Build from the repo root (it needs packages/core too):
#   docker build -f apps/server/Dockerfile -t meetme-server .
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so this layer is cached between code changes.
# All workspace package.json files are copied so package-lock.json matches.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci -w @meetme/server -w @meetme/core --omit=dev --ignore-scripts && npm cache clean --force

COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src

# The database lives on a volume, owned by the unprivileged "node" user.
RUN mkdir /data && chown node:node /data
USER node
ENV DB_PATH=/data/meetme.db PORT=8080 HOST=0.0.0.0
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1

WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
