"""Adaptador gRPC del worker.

El worker no habla SQL con la base de datos del catalogo: pide el cupo por
gRPC a catalogo-service. Esa es la razon de ser de la comunicacion
este-oeste entre servicios SOA y mantiene la propiedad exclusiva de los
datos en el servicio dueno del recurso.
"""

from __future__ import annotations

import logging

import grpc

from gen import catalogo_pb2, catalogo_pb2_grpc
from src.worker.application.ports import CatálogoPort, ClaimDeCupo

registrador = logging.getLogger("worker.grpc.catalogo")


class ClienteCatalogoGrpc(CatálogoPort):
    def __init__(self, objetivo: str, timeout: float = 5.0) -> None:
        self._timeout = timeout
        self._canal = grpc.insecure_channel(
            objetivo,
            options=[
                ("grpc.keepalive_time_ms", 30000),
                ("grpc.keepalive_permit_without_calls", 1),
                ("grpc.max_receive_message_length", 4 * 1024 * 1024),
            ],
        )
        self._stub = catalogo_pb2_grpc.CatalogoServiceStub(self._canal)

    def validar_evento(self, evento_id: str) -> tuple[bool, str]:
        respuesta = self._stub.ValidarEvento(
            catalogo_pb2.ValidarEventoRequest(evento_id=evento_id), timeout=self._timeout
        )
        return bool(respuesta.existe), respuesta.motivo

    def reclamar_cupo(
        self, evento_id: str, reserva_id: str, tracking_id: str
    ) -> ClaimDeCupo:
        respuesta = self._stub.ReclamarCupo(
            catalogo_pb2.ReclamarCupoRequest(
                evento_id=evento_id, reserva_id=reserva_id, tracking_id=tracking_id
            ),
            timeout=self._timeout,
        )
        return ClaimDeCupo(
            asignado=respuesta.resultado == catalogo_pb2.CUPO_ASIGNADO,
            resultado=catalogo_pb2.ResultadoCupo.Name(respuesta.resultado),
            cupos_disponibles=respuesta.cupos_disponibles,
            cupos_totales=respuesta.cupos_totales,
            titulo=respuesta.titulo,
            mensaje=respuesta.mensaje,
        )

    def liberar_cupo(self, evento_id: str, reserva_id: str) -> int:
        respuesta = self._stub.LiberarCupo(
            catalogo_pb2.LiberarCupoRequest(evento_id=evento_id, reserva_id=reserva_id),
            timeout=self._timeout,
        )
        return respuesta.cupos_disponibles

    def invalidar_cache(self, evento_id: str) -> None:
        try:
            self._stub.InvalidarCache(
                catalogo_pb2.InvalidarCacheRequest(evento_id=evento_id), timeout=self._timeout
            )
        except grpc.RpcError as error:  # pragma: no cover - depende del servidor
            registrador.warning("no se pudo invalidar la cache de %s: %s", evento_id, error)

    def cerrar(self) -> None:
        self._canal.close()
