FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.1-bookworm-slim AS service
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist /app/dist
USER node
EXPOSE 4000 4001
CMD ["node", "dist/api.mjs"]

FROM nginx:1.30.6-alpine AS web
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/web /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
