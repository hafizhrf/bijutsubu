FROM node:22-alpine AS dependencies
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN pnpm build

FROM node:22-alpine AS backend
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/dist ./backend/dist

WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/server.js"]

FROM nginx:1.27-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
