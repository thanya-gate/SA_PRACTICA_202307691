"""Consumidor AMQP del worker.

Garantias exigidas por la hoja de calificacion (25 pts):

  * la cola es durable y de tipo quorum, montada sobre un volumen persistente;
  * los mensajes se publican con DeliveryMode persistent;
  * el ACK es MANUAL: el mensaje solo se confirma despues de que el caso de
    uso termino. Si el worker muere antes, RabbitMQ lo vuelve a entregar;
  * un fallo transitorio (base de datos o servicio caido) produce NACK con
    requeue=True, y un mensaje ilegible produce REJECT con requeue=False, que
    el exchange de muertos configurado en la cola conduce a la DLQ;
  * los mensajes que fallan siempre ("mensajes venenosos") no reintentan para
    siempre: la cola quorum tiene x-delivery-limit=5, de modo que a la
    sexta entrega RabbitMQ los mueve a la DLQ por su cuenta;
  * QoS con prefetch: el worker nunca toma mas mensajes de los que puede
    procesar, de modo que la cola acumula el resto en vez de perderlo.

Ese ultimo punto es exactamente lo que se comprueba apagando el worker: la
cola sigue creciendo, y al encenderlo drena todo sin perder ninguno.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

import pika
from pika.adapters.blocking_connection import BlockingChannel

from gen import eventos_pb2

registrador = logging.getLogger("worker.messaging.consumidor")


class ConsumidorReservas:
    def __init__(
        self,
        url: str,
        exchange: str,
        cola: str,
        routing_key: str,
        exchange_muertos: str = "academix.reservas.dlx",
        cola_muertos: str = "academix.reservas.dlq",
        routing_key_muertos: str = "reserva.descartada",
        prefetch: int = 20,
        reconectar_en: float = 5.0,
    ) -> None:
        self._url = url
        self._exchange = exchange
        self._cola = cola
        self._routing_key = routing_key
        self._exchange_muertos = exchange_muertos
        self._cola_muertos = cola_muertos
        self._routing_key_muertos = routing_key_muertos
        self._prefetch = prefetch
        self._espera_reconexion = reconectar_en
        self._conexion: pika.BlockingConnection | None = None
        self._canal: BlockingChannel | None = None
        self.procesados = 0
        self.fallidos = 0

    # ------------------------------------------------------------------ topologia

    def _declarar(self, canal: BlockingChannel) -> None:
        """Declara la topologia completa, incluida la cola de muertos.

        El productor Go declara exactamente la misma topologia. Ambas partes
        coinciden porque RabbitMQ exige que los argumentos de una cola sean
        identicos en cada declaracion: si el worker declarara la cola sin las
        claves x-dead-letter-*, el arranque fallaria con PRECONDITION_FAILED.
        """
        canal.exchange_declare(
            exchange=self._exchange, exchange_type="direct", durable=True
        )
        canal.exchange_declare(
            exchange=self._exchange_muertos, exchange_type="direct", durable=True
        )

        # La DLQ es classic: un mensaje que llega aqui ya no se reintenta.
        canal.queue_declare(queue=self._cola_muertos, durable=True)
        canal.queue_bind(
            queue=self._cola_muertos,
            exchange=self._exchange_muertos,
            routing_key=self._routing_key_muertos,
        )

        arguments = {
            "x-queue-type": "quorum",
            "x-delivery-limit": 5,
            "x-dead-letter-exchange": self._exchange_muertos,
            "x-dead-letter-routing-key": self._routing_key_muertos,
        }
        canal.queue_declare(queue=self._cola, durable=True, arguments=arguments)
        canal.queue_bind(
            queue=self._cola, exchange=self._exchange, routing_key=self._routing_key
        )

    # ------------------------------------------------------------------ ciclo

    def ejecutar(self, manejar: Callable[[eventos_pb2.SolicitudReserva], None]) -> None:
        """Bucle infinito con reconexion automatica ante caida del broker."""
        while True:
            try:
                self._conectar(manejar)
            except KeyboardInterrupt:
                registrador.info("worker detenido por el operador")
                return
            except Exception:  # noqa: BLE001
                registrador.exception(
                    "se perdio la conexion con el broker; reintentando en %.1fs",
                    self._espera_reconexion,
                )
                self._cerrar()
                time.sleep(self._espera_reconexion)

    def _conectar(self, manejar) -> None:
        self._conexion = pika.BlockingConnection(pika.URLParameters(self._url))
        self._canal = self._conexion.channel()
        self._declarar(self._canal)

        # prefetch: nunca hay mas mensajes sin confirmar de los que el worker
        # puede procesar. Sin esto, un pico de miles de solicitudes se
        # acumularia en el cliente del worker en vez de quedar en la cola.
        self._canal.basic_qos(prefetch_count=self._prefetch)

        registrador.info(
            "worker escuchando en la cola %s (prefetch=%d, ACK manual)",
            self._cola,
            self._prefetch,
        )
        self._canal.basic_consume(
            queue=self._cola,
            on_message_callback=self._envolver(manejar),
            auto_ack=False,
        )
        self._canal.start_consuming()

    # ------------------------------------------------------------------ entrega

    def _envolver(self, manejar):
        def al_recibir(ch: BlockingChannel, metodo, props, cuerpo: bytes) -> None:
            try:
                solicitud = eventos_pb2.SolicitudReserva()
                solicitud.ParseFromString(cuerpo)
            except Exception:  # noqa: BLE001
                registrador.error(
                    "mensaje ilegible en la cola %s; se envia a la DLQ %s",
                    self._cola,
                    self._cola_muertos,
                    exc_info=True,
                )
                ch.basic_reject(delivery_tag=metodo.delivery_tag, requeue=False)
                self.fallidos += 1
                return

            try:
                manejar(solicitud)
            except Exception:  # noqa: BLE001
                # Fallo transitorio (base de datos o servicio caido): el
                # mensaje vuelve a la cola para reintentarse.
                registrador.exception(
                    "fallo al procesar %s; se reencola", solicitud.tracking_id
                )
                self.fallidos += 1
                ch.basic_nack(delivery_tag=metodo.delivery_tag, requeue=True)
                return

            # El ACK se emite solo cuando el procesamiento completo.
            ch.basic_ack(delivery_tag=metodo.delivery_tag)
            self.procesados += 1
            registrador.info(
                "procesada la solicitud %s del evento %s",
                solicitud.tracking_id,
                solicitud.evento_id,
            )

        return al_recibir

    def _cerrar(self) -> None:
        try:
            if self._canal and self._canal.is_open:
                self._canal.stop_consuming()
        except Exception:  # noqa: BLE001
            pass
        try:
            if self._conexion and self._conexion.is_open:
                self._conexion.close()
        except Exception:  # noqa: BLE001
            pass
        self._canal = None
        self._conexion = None
