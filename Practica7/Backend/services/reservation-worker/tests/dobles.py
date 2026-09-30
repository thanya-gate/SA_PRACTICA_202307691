"""Dobles en memoria de los puertos del worker.

Permiten probar el caso de uso completo sin levantar RabbitMQ, PostgreSQL,
Redis ni los servicios gRPC.
"""

from __future__ import annotations

from typing import Optional

from src.worker.application.ports import (
    CatálogoPort,
    ClaimDeCupo,
    CredencialesPort,
    PublicadorResultados,
    Reloj,
    ReservaRepositorio,
    SeguimientoCache,
)
from src.worker.domain.reserva import (
    EstadoReserva,
    PaseEmitido,
    ResultadoReserva,
    SolicitudReserva,
)

CLAVE_DE_PRUEBA = "clave-de-prueba-para-firmar"


class CatalogoEnMemoria(CatálogoPort):
    def __init__(self, eventos: dict[str, int], titulos: dict[str, str] | None = None) -> None:
        self.cupos = dict(eventos)
        self.titulos = titulos or {k: f"Taller {k}" for k in eventos}
        self.llamadas_reclamar = 0
        self.llamadas_liberar = 0
        self.cache_invalidadas: list[str] = []
        self.fallar_reclamo = False

    def validar_evento(self, evento_id: str) -> tuple[bool, str]:
        if evento_id not in self.cupos:
            return False, "El evento solicitado no existe."
        if self.cupos[evento_id] < 0:
            return False, "El evento no admite reservas."
        return True, ""

    def reclamar_cupo(
        self, evento_id: str, reserva_id: str, tracking_id: str
    ) -> ClaimDeCupo:
        if self.fallar_reclamo:
            raise RuntimeError("catalogo no disponible")
        self.llamadas_reclamar += 1
        total = max(self.cupos[evento_id], 0) + 1
        if self.cupos.get(evento_id, 0) <= 0:
            return ClaimDeCupo(
                asignado=False,
                resultado="SIN_CUPO",
                cupos_disponibles=0,
                cupos_totales=total,
                titulo=self.titulos.get(evento_id, ""),
                mensaje="No fue posible confirmar la reserva porque el evento no tiene cupos.",
            )
        self.cupos[evento_id] -= 1
        return ClaimDeCupo(
            asignado=True,
            resultado="CUPO_ASIGNADO",
            cupos_disponibles=self.cupos[evento_id],
            cupos_totales=total,
            titulo=self.titulos.get(evento_id, ""),
        )

    def liberar_cupo(self, evento_id: str, reserva_id: str) -> int:
        self.llamadas_liberar += 1
        if evento_id in self.cupos:
            self.cupos[evento_id] += 1
        return self.cupos.get(evento_id, 0)

    def invalidar_cache(self, evento_id: str) -> None:
        self.cache_invalidadas.append(evento_id)


class CredencialesEnMemoria(CredencialesPort):
    def __init__(self) -> None:
        self.registradas: list[dict] = []
        self.fallar = False

    def registrar_emision(self, codigo, titulo, titular, evento_id, firma, emitido_en, reserva_id):
        if self.fallar:
            raise RuntimeError("certificados no disponible")
        self.registradas.append(
            {
                "codigo": codigo,
                "titulo": titulo,
                "titular": titular,
                "evento_id": evento_id,
                "firma": firma,
                "emitido_en": emitido_en,
                "reserva_id": reserva_id,
            }
        )
        return True


class ReservasEnMemoria(ReservaRepositorio):
    def __init__(self) -> None:
        self.por_tracking: dict[str, ResultadoReserva] = {}
        self.fallar_en: Optional[str] = None
        self.llamadas = 0

    def resolver(
        self,
        solicitud: SolicitudReserva,
        estado: EstadoReserva,
        evento_titulo: str,
        mensaje: str,
        motivo_rechazo: Optional[str],
        pase: Optional[PaseEmitido],
    ) -> ResultadoReserva:
        self.llamadas += 1
        if self.fallar_en == solicitud.tracking_id:
            raise RuntimeError("base de datos no disponible")

        previo = self.por_tracking.get(solicitud.tracking_id)
        if previo is not None:
            return ResultadoReserva(
                tracking_id=previo.tracking_id,
                reserva_id=previo.reserva_id,
                evento_id=previo.evento_id,
                estado=previo.estado,
                mensaje=previo.mensaje,
                procesado_en=previo.procesado_en,
                evento_titulo=previo.evento_titulo,
                pase=previo.pase,
                ya_existia=True,
            )

        resultado = ResultadoReserva(
            tracking_id=solicitud.tracking_id,
            reserva_id=f"uuid-{len(self.por_tracking) + 1}",
            evento_id=solicitud.evento_id,
            estado=estado,
            mensaje=mensaje,
            procesado_en="2026-10-01T12:00:00.000Z",
            evento_titulo=evento_titulo,
            pase=pase,
        )
        self.por_tracking[solicitud.tracking_id] = resultado
        return resultado


class SeguimientoEnMemoria(SeguimientoCache):
    def __init__(self) -> None:
        self.guardados: list[ResultadoReserva] = []
        self.ttls: list[int] = []

    def guardar(self, resultado: ResultadoReserva, ttl_segundos: int) -> None:
        self.guardados.append(resultado)
        self.ttls.append(ttl_segundos)


class PublicadorEnMemoria(PublicadorResultados):
    def __init__(self) -> None:
        self.publicados: list[ResultadoReserva] = []

    def publicar(self, resultado: ResultadoReserva) -> None:
        self.publicados.append(resultado)


class RelojFijo(Reloj):
    def ahora(self) -> str:
        return "2026-10-01T12:00:00.000Z"


def solicitud_de_prueba(**cambios) -> SolicitudReserva:
    base = {
        "tracking_id": "TRK-1",
        "evento_id": "EVT-2026-001",
        "estudiante_nombre": "Ana Lopez",
        "estudiante_correo": "ana.lopez@usac.edu.gt",
        "canal": "vercel",
        "publicado_en": "2026-10-01T11:59:59.000Z",
        "intento": 1,
    }
    base.update(cambios)
    return SolicitudReserva(**base)
