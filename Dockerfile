FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY database ./database
COPY admin-ui ./admin-ui
COPY scripts/build-admin-ui.mjs ./scripts/build-admin-ui.mjs
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY database ./database
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
