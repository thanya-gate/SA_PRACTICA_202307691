"""Configuracion del worker leida del entorno."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _texto(clave: str, por_defecto: str) -> str:
    return os.getenv(clave) or por_defecto


def _entero(clave: str, por_defecto: int) -> int:
    try:
        return int(os.getenv(clave, "") or por_defecto)
    except ValueError:
        return por_defecto


@dataclass(frozen=True)
class ConfigWorker:
    version: str = "2.0.0"

    broker_url: str = _texto(
        "BROKER_URL", "amqp://academix:academix@rabbitmq:5672/%2F"
    )
    exchange: str = _texto("BROKER_EXCHANGE", "academix.reservas")
    cola_solicitudes: str = _texto("BROKER_COLA", "academix.reservas.solicitudes")
    routing_key: str = _texto("BROKER_ROUTING_KEY", "reserva.solicitada")
    exchange_resultados: str = _texto(
        "BROKER_EXCHANGE_RESULTADOS", "academix.reservas.resultados"
    )
    routing_key_resultados: str = _texto(
        "BROKER_ROUTING_KEY_RESULTADOS", "reserva.resultada"
    )
    prefetch: int = _entero("BROKER_PREFETCH", 20)
    exchange_muertos: str = _texto("BROKER_EXCHANGE_MUERTOS", "academix.reservas.dlx")
    cola_muertos: str = _texto("BROKER_COLA_MUERTOS", "academix.reservas.dlq")
    routing_key_muertos: str = _texto("BROKER_ROUTING_KEY_MUERTOS", "reserva.descartada")

    dsn_reservas: str = _texto(
        "DATABASE_URL",
        "postgresql://academix:academix_secret@postgres-reservas:5432/academix_reservas",
    )
    redis_url: str = _texto("REDIS_URL", "redis://redis:6379/0")
    redis_ttl: int = _entero("REDIS_TTL_SEGUNDOS", 86400)

    catalogo_grpc: str = _texto("CATALOGO_GRPC_ADDR", "catalogo-service:50061")
    certificados_grpc: str = _texto("CERTIFICADOS_GRPC_ADDR", "certificados-service:50063")

    clave_firma: str = _texto("CLAVE_FIRMA_PASE", "cambie-esta-clave-en-produccion")
    log_level: str = _texto("LOG_LEVEL", "INFO")


def cargar() -> ConfigWorker:
    return ConfigWorker()
