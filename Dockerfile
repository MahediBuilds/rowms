# ROW Manager - web admin + API in one image.
# Stage 1: build the React web admin
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Django API serving the built web admin
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEBUG=false WEB_DIST_DIR=/app/web/dist MEDIA_ROOT=/data/media
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/web/dist
RUN SECRET_KEY=build-only python manage.py collectstatic --noinput >/dev/null
RUN useradd --system --uid 1000 app && mkdir -p /data/media && chown -R app /data /app
USER app
EXPOSE 8000
COPY --chown=app docker-entrypoint.sh /app/docker-entrypoint.sh
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
