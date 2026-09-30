# =====================================================================
# reservation-worker (Python) - consumidor asincrono
# =====================================================================
FROM python:3.12-slim

# tini como PID 1: reenvia SIGTERM para que el apagado ordenado del worker
# (cerrar conexiones de AMQP, gRPC y PostgreSQL) se ejecute de verdad.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system academix \
    && adduser --system --ingroup academix academix

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Las dependencias se instalan antes que el codigo: mientras requirements no
# cambie, la capa se reutiliza entre despliegues.
COPY services/reservation-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/reservation-worker/ ./
COPY proto ./proto

USER academix

# El worker es un consumidor: no expone puertos, solo necesita salir hacia
# RabbitMQ, PostgreSQL, Redis y los dos servicios gRPC.
#
# El punto de entrada es main.py en la raiz del servicio, no
# src/worker/main.py: WORKDIR es /app y el COPY de arriba lo deposita ahi.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
