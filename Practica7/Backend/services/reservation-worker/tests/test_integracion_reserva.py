"""Prueba de integracion del ida y vuelta de la firma del pase.

Esta prueba tampoco corre en el pipeline unitario: necesita PostgreSQL con el
esquema de la practica cargado. Sin la variable de entorno se salta sola.

    set -a && . ./.env && set +a
    python -m pytest tests/test_integracion_reserva.py

Nota: `python -m pytest -m integracion`, que es lo que documenta
`test_integracion_cupo.py`, hoy no selecciona nada porque ningun test lleva ese
marcador y `pytest.ini` usa `--strict-markers`. Se invoca por ruta hasta que se
registre el marcador.

Cubre un fallo que los dobles no pueden detectar: el worker firma el pase, la
base lo guarda bien, pero al releer la fila para armar el resultado se perdia la
firma. El estado de seguimiento que consume el navegador llegaba con el pase sin
firma, y como la validacion de la credencial si recibia la firma correcta, el
fallo pasaba inadvertido en la mitad del camino.
"""

from __future__ import annotations

import os
import uuid

import pytest

from src.worker.domain.reserva import (
    EstadoReserva,
    PaseEmitido,
    SolicitudReserva,
    firmar_pase,
    verificar_firma,
)
from src.worker.infrastructure.persistence.reservas_repo import PostgresReservas

DSN = os.getenv("RESERVAS_DATABASE_URL", "")
CLAVE = "clave-de-prueba-para-integracion"

pytestmark = pytest.mark.skipif(
    not DSN, reason="requiere RESERVAS_DATABASE_URL apuntando a un PostgreSQL real"
)


def _solicitud() -> SolicitudReserva:
    return SolicitudReserva(
        tracking_id=f"IT-{uuid.uuid4().hex}",
        evento_id="EVT-2026-001",
        estudiante_nombre="Estudiante de Integracion",
        estudiante_correo="integracion@usac.edu.gt",
    )


def _pase(solicitud: SolicitudReserva) -> PaseEmitido:
    codigo = f"PASE-IT-{uuid.uuid4().hex[:6].upper()}"
    return PaseEmitido(
        codigo_validacion=codigo,
        firma=firmar_pase(codigo, solicitud.evento_id, CLAVE),
        titular=solicitud.estudiante_nombre,
        evento_id=solicitud.evento_id,
        evento_titulo="Evento de integracion",
        emitido_en="2026-01-01T00:00:00.000Z",
    )


@pytest.fixture()
def repo():
    yield PostgresReservas(DSN, minimo=1, maximo=2)


def test_la_firma_sobrevive_al_ida_y_vuelta(repo: PostgresReservas) -> None:
    solicitud = _solicitud()
    pase = _pase(solicitud)

    resultado = repo.resolver(
        solicitud=solicitud,
        estado=EstadoReserva.CONFIRMADA,
        evento_titulo=pase.evento_titulo,
        mensaje="Reserva confirmada.",
        motivo_rechazo=None,
        pase=pase,
    )

    assert resultado.estado is EstadoReserva.CONFIRMADA
    assert resultado.pase is not None
    assert resultado.pase.codigo_validacion == pase.codigo_validacion
    assert resultado.pase.firma == pase.firma, (
        "la firma se perdio al releer la fila: el seguimiento que consulta el "
        "navegador llegaria con el pase sin firmar"
    )
    assert verificar_firma(
        resultado.pase.codigo_validacion,
        solicitud.evento_id,
        CLAVE,
        resultado.pase.firma,
    )


def test_una_redelivery_conserva_la_firma_original(repo: PostgresReservas) -> None:
    """El broker puede redeliverar el mismo mensaje.

    En ese caso la fila ya existe y lo que debe viajar al navegador es la
    firma que quedo guardada la primera vez, no la del mensaje reintentado.
    """
    solicitud = _solicitud()
    pase = _pase(solicitud)

    repo.resolver(
        solicitud=solicitud,
        estado=EstadoReserva.CONFIRMADA,
        evento_titulo=pase.evento_titulo,
        mensaje="Reserva confirmada.",
        motivo_rechazo=None,
        pase=pase,
    )

    repetida = repo.resolver(
        solicitud=solicitud,
        estado=EstadoReserva.CONFIRMADA,
        evento_titulo=pase.evento_titulo,
        mensaje="Reserva confirmada.",
        motivo_rechazo=None,
        pase=pase,
    )

    assert repetida.ya_existia is True
    assert repetida.pase is not None
    assert repetida.pase.firma == pase.firma


def test_una_reserva_sin_pase_no_inventa_firma(repo: PostgresReservas) -> None:
    solicitud = _solicitud()

    resultado = repo.resolver(
        solicitud=solicitud,
        estado=EstadoReserva.RECHAZADA,
        evento_titulo="Evento de integracion",
        mensaje="La solicitud no pudo procesarse.",
        motivo_rechazo="ERROR_DE_VALIDACION",
        pase=None,
    )

    assert resultado.estado is EstadoReserva.RECHAZADA
    assert resultado.pase is None
