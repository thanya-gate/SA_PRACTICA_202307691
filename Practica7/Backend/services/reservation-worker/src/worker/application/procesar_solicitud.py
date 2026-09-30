"""Caso de uso del worker: procesar una solicitud de reserva de forma atomica.

Orden de operaciones (imprescindible para eligen el enunciado):

  1. validar el mensaje recibido;
  2. pedir a catalogo-service el cupo mediante la transaccion atomica;
  3. si hay cupo, emitir el pase firmado y persistir la reserva;
  4. si la persistencia falla, devolver el cupo a catalogo-service;
  5. invalidar la cache del catalogo y publicar el resultado.

El paso 4 evita que un fallo transitorio de la base de datos queme un cupo
que nadie va a usar.
"""

from __future__ import annotations

import dataclasses
import logging
import uuid

from src.worker.application.ports import (
    CatálogoPort,
    CredencialesPort,
    PublicadorResultados,
    Reloj,
    ReservaRepositorio,
    SeguimientoCache,
)
from src.worker.domain.reserva import (
    MENSAJES_POR_ESTADO,
    EstadoReserva,
    MotivoRechazo,
    PaseEmitido,
    ResultadoReserva,
    SolicitudReserva,
    ahora_iso,
    firmar_pase,
    generar_codigo_pase,
)

registrador = logging.getLogger("worker.procesar")


class ProcesarSolicitud:
    """Orquesta el procesamiento asincrono de una sola solicitud."""

    def __init__(
        self,
        catalogo: CatálogoPort,
        credenciales: CredencialesPort,
        reservas: ReservaRepositorio,
        seguimiento: SeguimientoCache,
        publicador: PublicadorResultados,
        reloj: Reloj,
        clave_firma: str,
        ttl_seguimiento: int = 86400,
    ) -> None:
        self._catalogo = catalogo
        self._credenciales = credenciales
        self._reservas = reservas
        self._seguimiento = seguimiento
        self._publicador = publicador
        self._reloj = reloj
        self._clave_firma = clave_firma
        self._ttl = ttl_seguimiento

    def ejecutar(self, solicitud: SolicitudReserva) -> ResultadoReserva:
        if not solicitud.es_valida():
            registrador.warning(
                "mensaje incompleto, se descarta sin tocar la BD: %s", solicitud
            )
            return ResultadoReserva(
                tracking_id=solicitud.tracking_id or "desconocido",
                reserva_id="",
                evento_id=solicitud.evento_id,
                estado=EstadoReserva.RECHAZADA,
                mensaje="El mensaje recibido no cumple el contrato academix.eventos.v1.",
                procesado_en=self._reloj.ahora(),
                motivo_rechazo=MotivoRechazo.EVENTO_INEXISTENTE,
            )

        reserva_id = str(uuid.uuid4())
        existe, motivo = self._catalogo.validar_evento(solicitud.evento_id)

        if not existe:
            return self._rechazar(
                solicitud,
                reserva_id,
                motivo or "El evento solicitado no existe.",
                MotivoRechazo.EVENTO_INEXISTENTE,
            )

        claim = self._catalogo.reclamar_cupo(
            solicitud.evento_id, reserva_id, solicitud.tracking_id
        )

        if not claim.asignado:
            motivo_rechazo = (
                MotivoRechazo.SIN_CUPO
                if claim.resultado == "SIN_CUPO"
                else MotivoRechazo.EVENTO_CERRADO
            )
            return self._persistir_sin_cupo(solicitud, reserva_id, claim, motivo_rechazo)

        codigo = generar_codigo_pase()
        emitido_en = self._reloj.ahora()
        pase = PaseEmitido(
            codigo_validacion=codigo,
            firma=firmar_pase(codigo, solicitud.evento_id, self._clave_firma),
            titular=solicitud.estudiante_nombre,
            evento_id=solicitud.evento_id,
            evento_titulo=claim.titulo,
            emitido_en=emitido_en,
        )

        resultado = self._persistir_confirmada(solicitud, reserva_id, pase, claim.titulo)

        if resultado.ya_existia:
            registrador.info(
                "el tracking %s ya estaba procesado; se omite la emision",
                solicitud.tracking_id,
            )
            self._catalogo.liberar_cupo(solicitud.evento_id, reserva_id)
        else:
            try:
                self._credenciales.registrar_emision(
                    codigo=pase.codigo_validacion,
                    titulo=f"Asistencia: {claim.titulo}",
                    titular=solicitud.estudiante_nombre,
                    evento_id=solicitud.evento_id,
                    firma=pase.firma,
                    emitido_en=pase.emitido_en,
                    reserva_id=resultado.reserva_id,
                )
            except Exception:  # noqa: BLE001
                registrador.exception(
                    "no se pudo registrar la credencial %s; la reserva sigue confirmada",
                    pase.codigo_validacion,
                )

        self._catalogo.invalidar_cache(solicitud.evento_id)
        self._difundir(resultado)
        return resultado

    def _persistir_confirmada(
        self,
        solicitud: SolicitudReserva,
        reserva_id: str,
        pase: PaseEmitido,
        titulo_evento: str,
    ) -> ResultadoReserva:
        """Escribe la reserva y devuelve el cupo si la escritura falla.

        Si la base de datos esta momentaneamente inaccesible, el mensaje se
        devolvera a la cola. Como el cupo ya fue descontado, hay que
        devolverlo o el evento perderia una plaza que nadie ocupa.
        """
        try:
            return self._reservas.resolver(
                solicitud=solicitud,
                estado=EstadoReserva.CONFIRMADA,
                evento_titulo=titulo_evento,
                mensaje=MENSAJES_POR_ESTADO[EstadoReserva.CONFIRMADA],
                motivo_rechazo=None,
                pase=pase,
            )
        except Exception:
            registrador.exception(
                "fallo al persistir la reserva %s; se devuelve el cupo",
                solicitud.tracking_id,
            )
            try:
                self._catalogo.liberar_cupo(solicitud.evento_id, reserva_id)
            except Exception:  # noqa: BLE001
                registrador.exception("no se pudo devolver el cupo de %s", solicitud.evento_id)
            raise

    def _rechazar(
        self,
        solicitud: SolicitudReserva,
        reserva_id: str,
        mensaje: str,
        motivo: MotivoRechazo,
    ) -> ResultadoReserva:
        persistido = self._reservas.resolver(
            solicitud=solicitud,
            estado=EstadoReserva.RECHAZADA,
            evento_titulo="",
            mensaje=mensaje,
            motivo_rechazo=motivo.value,
            pase=None,
        )
        resultado = dataclasses.replace(persistido, motivo_rechazo=motivo)
        self._difundir(resultado)
        return resultado

    def _persistir_sin_cupo(
        self,
        solicitud: SolicitudReserva,
        reserva_id: str,
        claim,
        motivo: MotivoRechazo,
    ) -> ResultadoReserva:
        persistido = self._reservas.resolver(
            solicitud=solicitud,
            estado=EstadoReserva.SIN_CUPO,
            evento_titulo=claim.titulo,
            mensaje=claim.mensaje or MENSAJES_POR_ESTADO[EstadoReserva.SIN_CUPO],
            motivo_rechazo=motivo.value,
            pase=None,
        )
        resultado = dataclasses.replace(persistido, motivo_rechazo=motivo)
        self._catalogo.invalidar_cache(solicitud.evento_id)
        self._difundir(resultado)
        return resultado

    def _difundir(self, resultado: ResultadoReserva) -> None:
        try:
            self._seguimiento.guardar(resultado, self._ttl)
        except Exception:  # noqa: BLE001
            registrador.exception("no se pudo escribir el seguimiento en Redis")
        try:
            self._publicador.publicar(resultado)
        except Exception:  # noqa: BLE001
            registrador.exception("no se pudo publicar el resultado en el exchange")


class RelojSistema(Reloj):
    def ahora(self) -> str:
        return ahora_iso()
