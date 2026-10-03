"""Adaptador de Redis para el seguimiento de reservas.

El productor (reservas-service) lee de aqui para responder las consultas de
estado sin abrir conexion a la base de datos. Redis es cache y no fuente de
verdad: si se pierde, el siguiente procesamiento la vuelve a escribir.

El valor almacenado es el mensaje academix.eventos.v1.ResultadoReserva
serializado en protobuf, el mismo contrato que viaja por el broker. Asi el
estado guardado usa exactamente el esquema que el productor ya deserializa.
"""

from __future__ import annotations

import logging

import redis

from gen import eventos_pb2
from src.worker.application.ports import SeguimientoCache
from src.worker.domain.reserva import ResultadoReserva

registrador = logging.getLogger("worker.cache.seguimiento")

PREFIJO = "academix:seguimiento:"

ESTADO_A_ENUM = {
    "PENDIENTE": eventos_pb2.PENDIENTE,
    "CONFIRMADA": eventos_pb2.CONFIRMADA,
    "RECHAZADA": eventos_pb2.RECHAZADA,
    "SIN_CUPO": eventos_pb2.SIN_CUPO,
}


class RedisSeguimiento(SeguimientoCache):
    def __init__(self, url: str) -> None:
        self._cliente = redis.Redis.from_url(url)

    def guardar(self, resultado: ResultadoReserva, ttl_segundos: int) -> None:
        mensaje = eventos_pb2.ResultadoReserva(
            tracking_id=resultado.tracking_id,
            reserva_id=resultado.reserva_id,
            evento_id=resultado.evento_id,
            estado=ESTADO_A_ENUM[resultado.estado.value],
            mensaje=resultado.mensaje,
            procesado_en=resultado.procesado_en,
            motivo_rechazo=(
                resultado.motivo_rechazo.value if resultado.motivo_rechazo else ""
            ),
        )
        if resultado.pase:
            mensaje.ticket.codigo_validacion = resultado.pase.codigo_validacion
            mensaje.ticket.firma = resultado.pase.firma
            mensaje.ticket.emitido_en = resultado.pase.emitido_en
            mensaje.ticket.evento_id = resultado.pase.evento_id
            mensaje.ticket.titular = resultado.pase.titular
            mensaje.ticket.evento_titulo = resultado.pase.evento_titulo

        self._cliente.set(
            PREFIJO + resultado.tracking_id,
            mensaje.SerializeToString(),
            ex=ttl_segundos,
        )

    def ping(self) -> bool:
        return bool(self._cliente.ping())

    def cerrar(self) -> None:
        self._cliente.close()
