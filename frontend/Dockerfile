# syntax=docker/dockerfile:1
# Фронтенд собирается в статику и раздаётся nginx; он же проксирует /api на контейнер API,
# поэтому двойник, пульт HMI и админка работают с одного источника (относительные /api, ws и SSE).
FROM node:22-alpine AS build

WORKDIR /app

# npm ci — по локфайлу, без обращения к сети за новыми версиями
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Три точки входа (index.html, hmi.html, admin.html), GLB-модели и шрифты лежат в public/
COPY frontend/ ./
# build = tsc --noEmit && vite build: битые типы не попадут в деплой
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1/index.html"]
