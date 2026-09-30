"""Punto de entrada del Worker / Consumidor Asincrono.

Arranca el consumidor de RabbitMQ con ACK manual y conecta cada mensaje al
caso de uso ProcesarSolicitud. El worker no expone HTTP: es un proceso de
segundo plano sin puertos de entrada.
"""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType

from gen import eventos_pb2
from src.worker.application.procesar_solicitud import ProcesarSolicitud, RelojSistema
from src.worker.config.config import cargar
from src.worker.domain.reserva import SolicitudReserva
from src.worker.infrastructure.grpc_clients.catalogo_client import ClienteCatalogoGrpc
from src.worker.infrastructure.grpc_clients.credenciales_client import (
    ClienteCredencialesGrpc,
)
from src.worker.infrastructure.messaging.consumidor import ConsumidorReservas
from src.worker.infrastructure.messaging.publicador import PublicadorResultadosRabbit
from src.worker.infrastructure.persistence.redis_seguimiento import RedisSeguimiento
from src.worker.infrastructure.persistence.reservas_repo import PostgresReservas


def configurar_logging(nivel: str) -> None:
    logging.basicConfig(
        level=getattr(logging, nivel.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
    )


def construir_caso_de_uso(config):
    catalogo = ClienteCatalogoGrpc(config.catalogo_grpc)
    credenciales = ClienteCredencialesGrpc(config.certificados_grpc)
    reservas = PostgresReservas(config.dsn_reservas)
    seguimiento = RedisSeguimiento(config.redis_url)
    publicador = PublicadorResultadosRabbit(
        config.broker_url, config.exchange_resultados, config.routing_key_resultados
    )
    return (
        ProcesarSolicitud(
            catalogo=catalogo,
            credenciales=credenciales,
            reservas=reservas,
            seguimiento=seguimiento,
            publicador=publicador,
            reloj=RelojSistema(),
            clave_firma=config.clave_firma,
            ttl_seguimiento=config.redis_ttl,
        ),
        (catalogo, credenciales, reservas, seguimiento, publicador),
    )


def main() -> int:
    config = cargar()
    configurar_logging(config.log_level)
    registro = logging.getLogger("worker")

    registro.info("reservation-worker v%s iniciando", config.version)

    caso, recursos = construir_caso_de_uso(config)

    consumidor = ConsumidorReservas(
        url=config.broker_url,
        exchange=config.exchange,
        cola=config.cola_solicitudes,
        routing_key=config.routing_key,
        exchange_muertos=config.exchange_muertos,
        cola_muertos=config.cola_muertos,
        routing_key_muertos=config.routing_key_muertos,
        prefetch=config.prefetch,
    )

    def al_terminar(_senal: int, _marco: FrameType | None) -> None:
        registro.info("senal de terminacion recibida")
        for recurso in recursos:
            try:
                recurso.cerrar()
            except Exception:  # noqa: BLE001
                pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, al_terminar)
    signal.signal(signal.SIGINT, al_terminar)

    def manejar(mensaje: eventos_pb2.SolicitudReserva) -> None:
        caso.ejecutar(
            SolicitudReserva(
                tracking_id=mensaje.tracking_id,
                evento_id=mensaje.evento_id,
                estudiante_nombre=mensaje.estudiante_nombre,
                estudiante_correo=mensaje.estudiante_correo,
                canal=mensaje.canal,
                publicado_en=mensaje.publicado_en,
                intento=mensaje.intento,
            )
        )

    consumidor.ejecutar(manejar)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
