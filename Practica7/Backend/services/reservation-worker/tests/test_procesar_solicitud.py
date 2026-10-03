"""Pruebas del caso de uso ProcesarSolicitud del worker.

Cubren el camino feliz, el agotamiento de cupos, la idempotencia ante
redelivery del broker y la devolucion del cupo cuando la base de datos falla.
"""

from __future__ import annotations

import pytest

from src.worker.application.procesar_solicitud import ProcesarSolicitud
from src.worker.domain.reserva import (
    EstadoReserva,
    MotivoRechazo,
    verificar_firma,
)
from tests.dobles import (
    CLAVE_DE_PRUEBA,
    CatalogoEnMemoria,
    CredencialesEnMemoria,
    PublicadorEnMemoria,
    RelojFijo,
    ReservasEnMemoria,
    SeguimientoEnMemoria,
    solicitud_de_prueba,
)


class Componentes:
    """Agrupa los dobles para que cada prueba sea legible."""

    def __init__(self, cupos: dict[str, int] | None = None) -> None:
        self.catalogo = CatalogoEnMemoria(cupos or {"EVT-2026-001": 1})
        self.credenciales = CredencialesEnMemoria()
        self.reservas = ReservasEnMemoria()
        self.seguimiento = SeguimientoEnMemoria()
        self.publicador = PublicadorEnMemoria()
        self.caso = ProcesarSolicitud(
            catalogo=self.catalogo,
            credenciales=self.credenciales,
            reservas=self.reservas,
            seguimiento=self.seguimiento,
            publicador=self.publicador,
            reloj=RelojFijo(),
            clave_firma=CLAVE_DE_PRUEBA,
            ttl_seguimiento=3600,
        )


def test_confirma_la_reserva_y_emite_el_pase_firmado() -> None:
    partes = Componentes({"EVT-2026-001": 2})

    resultado = partes.caso.ejecutar(solicitud_de_prueba())

    assert resultado.estado is EstadoReserva.CONFIRMADA
    assert resultado.pase is not None
    assert resultado.pase.codigo_validacion.startswith("PASE-")
    assert verificar_firma(
        resultado.pase.codigo_validacion,
        "EVT-2026-001",
        CLAVE_DE_PRUEBA,
        resultado.pase.firma,
    ), "la firma del pase debe validar con la clave compartida"
    assert partes.catalogo.cupos["EVT-2026-001"] == 1
    assert len(partes.credenciales.registradas) == 1
    assert partes.catalogo.cache_invalidadas == ["EVT-2026-001"]


def test_devuelve_SIN_CUPO_sin_intentar_persistir_el_pase() -> None:
    partes = Componentes({"EVT-2026-001": 0})

    resultado = partes.caso.ejecutar(solicitud_de_prueba())

    assert resultado.estado is EstadoReserva.SIN_CUPO
    assert resultado.motivo_rechazo is MotivoRechazo.SIN_CUPO
    assert resultado.pase is None
    assert partes.credenciales.registradas == []


def test_rechaza_un_evento_inexistente_sin_tocar_el_catalogo() -> None:
    partes = Componentes({"EVT-2026-001": 5})

    resultado = partes.caso.ejecutar(solicitud_de_prueba(evento_id="EVT-NO-EXISTE"))

    assert resultado.estado is EstadoReserva.RECHAZADA
    assert resultado.motivo_rechazo is MotivoRechazo.EVENTO_INEXISTENTE
    assert partes.catalogo.llamadas_reclamar == 0
    assert partes.catalogo.cupos["EVT-2026-001"] == 5


def test_descarta_un_mensaje_incompleto_sin_tocar_la_base_de_datos() -> None:
    partes = Componentes()

    resultado = partes.caso.ejecutar(solicitud_de_prueba(estudiante_correo=""))

    assert resultado.estado is EstadoReserva.RECHAZADA
    assert partes.reservas.llamadas == 0
    assert partes.catalogo.llamadas_reclamar == 0


def test_redelivery_del_broker_no_crea_una_segunda_reserva() -> None:
    partes = Componentes({"EVT-2026-001": 5})
    solicitud = solicitud_de_prueba()

    primero = partes.caso.ejecutar(solicitud)
    segundo = partes.caso.ejecutar(solicitud)

    assert primero.reserva_id == segundo.reserva_id
    assert segundo.ya_existia is True
    assert len(partes.reservas.por_tracking) == 1
    # El cupo del reintento se devuelve: de 5 plazas iniciales solo queda
    # consumida la de la primera entrega efectiva.
    assert partes.catalogo.cupos["EVT-2026-001"] == 4
    assert partes.catalogo.llamadas_liberar == 1
    # La credencial se emite una sola vez, no una por entrega.
    assert len(partes.credenciales.registradas) == 1


def test_devuelve_el_cupo_si_la_persistencia_falla() -> None:
    partes = Componentes({"EVT-2026-001": 1})
    partes.reservas.fallar_en = "TRK-1"

    with pytest.raises(RuntimeError, match="base de datos no disponible"):
        partes.caso.ejecutar(solicitud_de_prueba())

    assert partes.catalogo.cupos["EVT-2026-001"] == 1, (
        "el cupo debe regresar al catalogo para que nadie lo pierda"
    )


def test_un_fallo_al_registrar_la_credencial_no_revierte_la_reserva() -> None:
    partes = Componentes({"EVT-2026-001": 3})
    partes.credenciales.fallar = True

    resultado = partes.caso.ejecutar(solicitud_de_prueba())

    assert resultado.estado is EstadoReserva.CONFIRMADA
    assert partes.catalogo.cupos["EVT-2026-001"] == 2


def test_publica_el_resultado_en_el_seguimiento_y_en_el_exchange() -> None:
    partes = Componentes({"EVT-2026-001": 1})

    partes.caso.ejecutar(solicitud_de_prueba())

    assert len(partes.seguimiento.guardados) == 1
    assert partes.seguimiento.ttls == [3600]
    assert len(partes.publicador.publicados) == 1
    assert partes.publicador.publicados[0].estado is EstadoReserva.CONFIRMADA


def test_un_error_del_catalogo_propaga_para_que_el_broker_reencole() -> None:
    partes = Componentes({"EVT-2026-001": 1})
    partes.catalogo.fallar_reclamo = True

    with pytest.raises(RuntimeError, match="catalogo no disponible"):
        partes.caso.ejecutar(solicitud_de_prueba())

    # No se escribe nada en Redis ni en el exchange: el mensaje vuelve a la cola.
    assert partes.seguimiento.guardados == []
    assert partes.publicador.publicados == []
