#!/bin/sh
set -e
python manage.py migrate --noinput
if [ "${SEED_DEMO:-false}" = "true" ]; then
  python manage.py seed_demo
fi
if [ -n "${ADMIN_USERNAME}" ] && [ -n "${ADMIN_PASSWORD}" ]; then
  python manage.py ensure_admin
fi
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${WEB_WORKERS:-3} --timeout 120 --access-logfile -
