"""Publicador de resultados en el exchange de resultados.

Es el unico punto por el que el worker publica. Usa confirmaciones del
broker y mensajes persistentes, igual que el productor de solicitudes, para
que un resultado tampoco se pierda.
"""

from __future__ import annotations

import logging

import pika

from gen import eventos_pb2
from src.worker.application.ports import PublicadorResultados
from src.worker.domain.reserva import ResultadoReserva

registrador = logging.getLogger("worker.messaging.publicador")

ESTADO_A_ENUM = {
    "PENDIENTE": eventos_pb2.PENDIENTE,
    "CONFIRMADA": eventos_pb2.CONFIRMADA,
    "RECHAZADA": eventos_pb2.RECHAZADA,
    "SIN_CUPO": eventos_pb2.SIN_CUPO,
}


class PublicadorResultadosRabbit(PublicadorResultados):
    def __init__(
        self,
        url: str,
        exchange_resultados: str,
        routing_key_resultados: str,
    ) -> None:
        self._url = url
        self._exchange = exchange_resultados
        self._routing_key = routing_key_resultados
        self._conexion: pika.BlockingConnection | None = None
        self._canal = None

    def _conectar(self):
        if self._conexion is not None and self._conexion.is_open:
            return self._canal
        self._conexion = pika.BlockingConnection(pika.URLParameters(self._url))
        self._canal = self._conexion.channel()
        self._canal.exchange_declare(
            exchange=self._exchange, exchange_type="fanout", durable=True
        )
        self._canal.confirm_delivery()
        return self._canal

    def publicar(self, resultado: ResultadoReserva) -> None:
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

        canal = self._conectar()
        publicado = canal.basic_publish(
            exchange=self._exchange,
            routing_key=self._routing_key,
            body=mensaje.SerializeToString(),
            properties=pika.BasicProperties(
                content_type="application/x-protobuf",
                delivery_mode=pika.DeliveryMode.Persistent,
                correlation_id=resultado.tracking_id,
                message_id=resultado.reserva_id,
            ),
            mandatory=False,
        )
        if publicado is False:
            raise RuntimeError("el broker no confirmo el resultado")

    def cerrar(self) -> None:
        if self._conexion and self._conexion.is_open:
            self._conexion.close()
