"""Puertos del worker: abstracciones que define la aplicacion.

Cada interfaz corresponde a un adaptador de infraestructura. La aplicacion
depende solo de estas abstracciones (inversion de dependencias), por lo que
las pruebas pueden inyectar dobles sin levantar RabbitMQ, Postgres ni gRPC.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

from src.worker.domain.reserva import (
    EstadoReserva,
    PaseEmitido,
    ResultadoReserva,
    SolicitudReserva,
)


@dataclass(frozen=True)
class ClaimDeCupo:
    """Respuesta del servicio de catalogo al intento de reservar un cupo."""

    asignado: bool
    resultado: str
    cupos_disponibles: int
    cupos_totales: int
    titulo: str
    mensaje: str = ""


class CatálogoPort(ABC):
    """Comunicacion este-oeste con catalogo-service por gRPC."""

    @abstractmethod
    def validar_evento(self, evento_id: str) -> tuple[bool, str]:
        """Devuelve (existe, motivo) sin reservar cupo todavia."""
        raise NotImplementedError

    @abstractmethod
    def reclamar_cupo(self, evento_id: str, reserva_id: str, tracking_id: str) -> ClaimDeCupo:
        """Ejecuta la transaccion atomica que descuenta el cupo."""
        raise NotImplementedError

    @abstractmethod
    def liberar_cupo(self, evento_id: str, reserva_id: str) -> int:
        """Devuelve el cupo cuando la reserva resulto invalida."""
        raise NotImplementedError

    @abstractmethod
    def invalidar_cache(self, evento_id: str) -> None:
        """Invalida la entrada de Redis del catalogo tras un cambio."""
        raise NotImplementedError


class CredencialesPort(ABC):
    """Registra el pase emitido para que el verificador publico lo encuentre."""

    @abstractmethod
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
        raise NotImplementedError


class ReservaRepositorio(ABC):
    """Persistencia del resultado en reservas-db, propiedad del worker."""

    @abstractmethod
    def resolver(
        self,
        solicitud: SolicitudReserva,
        estado: EstadoReserva,
        evento_titulo: str,
        mensaje: str,
        motivo_rechazo: Optional[str],
        pase: Optional[PaseEmitido],
    ) -> ResultadoReserva:
        """Escribe la reserva de forma atomica e idempotente.

        Si el tracking_id ya fue procesado devuelve el resultado previo con
        ya_existia=True en lugar de crear un segundo registro.
        """
        raise NotImplementedError


class SeguimientoCache(ABC):
    """Redis donde el productor lee el estado final del procesamiento."""

    @abstractmethod
    def guardar(self, resultado: ResultadoReserva, ttl_segundos: int) -> None:
        raise NotImplementedError


class PublicadorResultados(ABC):
    """Publica el resultado en el exchange de resultados."""

    @abstractmethod
    def publicar(self, resultado: ResultadoReserva) -> None:
        raise NotImplementedError


class Reloj(ABC):
    @abstractmethod
    def ahora(self) -> str:
        raise NotImplementedError
