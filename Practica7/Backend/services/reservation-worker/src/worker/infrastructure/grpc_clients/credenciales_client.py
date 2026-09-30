"""Cliente gRPC de certificados-service.

El worker registra la credencial en el momento de emitir el pase, de modo que
la base de datos de credenciales sea la unica fuente de verdad cuando el
verificador publico consulta un codigo.
"""

from __future__ import annotations

import logging

import grpc

from gen import certificados_pb2, certificados_pb2_grpc
from src.worker.application.ports import CredencialesPort

registrador = logging.getLogger("worker.grpc.credenciales")


class ClienteCredencialesGrpc(CredencialesPort):
    def __init__(self, objetivo: str, timeout: float = 5.0) -> None:
        self._timeout = timeout
        self._canal = grpc.insecure_channel(objetivo)
        self._stub = certificados_pb2_grpc.CertificadosServiceStub(self._canal)

    def registrar_emision(
        self,
        codigo: str,
        titulo: str,
        titular: str,
        evento_id: str,
        firma: str,
        emitido_en: str,
        reserva_id: str,
    ) -> bool:
        respuesta = self._stub.RegistrarEmision(
            certificados_pb2.RegistrarEmisionRequest(
                codigo=codigo,
                titulo=titulo,
                titular=titular,
                evento_id=evento_id,
                firma=firma,
                emitido_en=emitido_en,
                reserva_id=reserva_id,
            ),
            timeout=self._timeout,
        )
        return bool(respuesta.registrada)

    def cerrar(self) -> None:
        self._canal.close()
