# syntax=docker/dockerfile:1
# API цифрового двойника: FastAPI + uvicorn, симулятор ПЛК и OPC UA-сервер в том же процессе.
# Контекст сборки — корень репозитория: при первом запуске хранилище заполняется из DOCX кейса,
# поэтому в образ нужен и docs/case (см. app/config.py: CASE_FILE ищется рядом с backend/).
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # изменяемое состояние — на томе, а не в слоях образа
    TWIN_DB=/var/lib/allur/twin.db \
    SCADA_DB=/var/lib/allur/scada.db \
    SCADA_USERS=/var/lib/allur/scada_users.json

WORKDIR /app/backend

# Отдельный слой: зависимости переустанавливаются только при правке requirements.txt
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY docs/case/ /app/docs/case/
COPY backend/docker-entrypoint.sh /usr/local/bin/allur-entrypoint

# Процесс не должен иметь права править собственный код; каталог состояния — его.
RUN chmod +x /usr/local/bin/allur-entrypoint \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin allur \
    && mkdir -p /var/lib/allur \
    && chown allur:allur /var/lib/allur
USER allur
VOLUME /var/lib/allur

EXPOSE 8000 4840

# Без curl в slim-образе: проверяем тем же Python, что и приложение.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["allur-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
