"""Pruebas de las reglas puras del dominio del worker."""

from __future__ import annotations

from src.worker.domain.reserva import (
    SolicitudReserva,
    firmar_pase,
    generar_codigo_pase,
    verificar_firma,
)

CLAVE = "clave-secreta-de-la-practica"


def test_el_codigo_del_pase_tiene_el_formato_esperado() -> None:
    codigo = generar_codigo_pase()
    assert codigo.startswith("PASE-")
    assert len(codigo) == len("PASE-XXXX-XXXX")
    assert codigo.count("-") == 2


def test_los_codigos_son_aleatorios() -> None:
    codigos = {generar_codigo_pase() for _ in range(500)}
    assert len(codigos) > 490, "los codigos deben ser impredecibles"


def test_la_firma_detecta_un_pase_alterado() -> None:
    firma = firmar_pase("PASE-AAAA-BBBB", "EVT-2026-001", CLAVE)

    assert verificar_firma("PASE-AAAA-BBBB", "EVT-2026-001", CLAVE, firma)
    assert not verificar_firma("PASE-AAAA-CCCC", "EVT-2026-001", CLAVE, firma)
    assert not verificar_firma("PASE-AAAA-BBBB", "EVT-2026-999", CLAVE, firma)
    assert not verificar_firma("PASE-AAAA-BBBB", "EVT-2026-001", "otra-clave", firma)


def test_una_solicitud_incompleta_no_es_valida() -> None:
    assert not SolicitudReserva(
        tracking_id="", evento_id="EVT-1", estudiante_nombre="Ana", estudiante_correo="a@b.c"
    ).es_valida()
    assert not SolicitudReserva(
        tracking_id="TRK-1", evento_id="", estudiante_nombre="Ana", estudiante_correo="a@b.c"
    ).es_valida()
    assert SolicitudReserva(
        tracking_id="TRK-1",
        evento_id="EVT-1",
        estudiante_nombre="Ana",
        estudiante_correo="a@b.c",
    ).es_valida()
