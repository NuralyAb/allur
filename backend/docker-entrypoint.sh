#!/bin/sh
# Учётные записи SCADA и админки лежат в одном JSON, который приложение правит на ходу
# (создание пользователей, блокировка, смена пароля). В образе он read-only, поэтому при
# первом запуске переносим эталон на том и дальше работаем с копией.
set -e

users="${SCADA_USERS:-/var/lib/allur/scada_users.json}"
if [ ! -f "$users" ]; then
  mkdir -p "$(dirname "$users")"
  cp /app/backend/app/data/scada_users.json "$users"
  echo "allur: учётные записи инициализированы в $users (пароли по умолчанию — смените их)" >&2
fi

exec "$@"
