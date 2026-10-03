"""Modelo de dominio del procesamiento asincrono de reservas.

Este modulo no importa grpc, pika, psycopg ni redis. Solo contiene el
vocabulario del negocio y las reglas puras, de modo que pueda probarse sin
levantar ninguna infraestructura.
"""

from __future__ import annotations

import enum
import hmac
import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone


class EstadoReserva(enum.Enum):
    """Estados posibles de una reserva. Refleja CU-P7-03 de la practica 7."""

    PENDIENTE = "PENDIENTE"
    CONFIRMADA = "CONFIRMADA"
    RECHAZADA = "RECHAZADA"
    SIN_CUPO = "SIN_CUPO"


class MotivoRechazo(enum.Enum):
    """Causa por la que el worker no pudo confirmar una reserva."""

    EVENTO_INEXISTENTE = "EVENTO_INEXISTENTE"
    EVENTO_CERRADO = "EVENTO_CERRADO"
    SIN_CUPO = "SIN_CUPO"
    EVENTO_DUPLICADO = "EVENTO_DUPLICADO"
    CORREO_DUPLICADO = "CORREO_DUPLICADO"
    PERSISTENCIA_FALLIDA = "PERSISTENCIA_FALLIDA"


@dataclass(frozen=True)
class SolicitudReserva:
    """Mensaje-consumer del broker: lo que publico el productor."""

    tracking_id: str
    evento_id: str
    estudiante_nombre: str
    estudiante_correo: str
    canal: str = "web"
    publicado_en: str = ""
    intento: int = 1

    def es_valida(self) -> bool:
        return bool(
            self.tracking_id
            and self.evento_id
            and self.estudiante_nombre
            and self.estudiante_correo
        )


@dataclass(frozen=True)
class PaseEmitido:
    """Pase generado por el worker con su codigo de validacion y firma."""

    codigo_validacion: str
    firma: str
    titular: str
    evento_id: str
    evento_titulo: str
    emitido_en: str


@dataclass(frozen=True)
class ResultadoReserva:
    """Salida del worker tras intentar resolver la solicitud."""

    tracking_id: str
    reserva_id: str
    evento_id: str
    estado: EstadoReserva
    mensaje: str
    procesado_en: str
    evento_titulo: str = ""
    motivo_rechazo: MotivoRechazo | None = None
    pase: PaseEmitido | None = None
    ya_existia: bool = False
    reintentos: list[str] = field(default_factory=list)


def ahora_iso() -> str:
    """Marca de tiempo UTC en RFC 3339, usada en los contratos y la BD."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def generar_codigo_pase(prefijo: str = "PASE") -> str:
    """Codigo de validacion legible por una persona y unico en la practica.

    Formato PASE-XXXX-XXXX. Se usa secrets en lugar de random porque el
    codigo es una credencial: debe ser impredecible para un atacante.
    """
    alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    bloque = lambda: "".join(secrets.choice(alfabeto) for _ in range(4))  # noqa: E731
    return f"{prefijo}-{bloque()}-{bloque()}"


def firmar_pase(codigo_validacion: str, evento_id: str, clave_secreta: str) -> str:
    """Firma HMAC-SHA256 del pase.

    El verificador recalcula esta firma para comprobar que el codigo impreso
    no fue alterado por un tercero.
    """
    mensaje = f"{codigo_validacion}|{evento_id}".encode("utf-8")
    firma = hmac.new(clave_secreta.encode("utf-8"), mensaje, hashlib.sha256).hexdigest()
    return firma[:32]


def verificar_firma(codigo_validacion: str, evento_id: str, clave_secreta: str, firma: str) -> bool:
    """Comparacion en tiempo constante de la firma de un pase."""
    esperada = firmar_pase(codigo_validacion, evento_id, clave_secreta)
    return hmac.compare_digest(esperada, firma)


MENSAJES_POR_ESTADO: dict[EstadoReserva, str] = {
    EstadoReserva.CONFIRMADA: "La reserva fue confirmada y el pase ya esta disponible.",
    EstadoReserva.SIN_CUPO: "No fue posible confirmar la reserva porque el evento agoto sus cupos.",
    EstadoReserva.RECHAZADA: "La solicitud no pudo procesarse.",
}
