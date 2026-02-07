FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build && rm -rf node_modules package.json package-lock.json js/src

FROM node:20-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --production
COPY backend/src ./src
COPY --from=frontend-build /build ./public
EXPOSE 8080
CMD ["node", "src/index.js"]
