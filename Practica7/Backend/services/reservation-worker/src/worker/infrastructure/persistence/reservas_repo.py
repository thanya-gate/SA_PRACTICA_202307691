"""Repositorio de reservas sobre PostgreSQL con psycopg3.

La escritura delega en la funcion fn_resolver_reserva definida en
02-reservas.sql, que es idempotente por tracking_id. Aqui solo se traduce
entre filas de PostgreSQL y objetos de dominio.
"""

from __future__ import annotations

import logging
from typing import Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.worker.application.ports import ReservaRepositorio
from src.worker.domain.reserva import (
    EstadoReserva,
    PaseEmitido,
    ResultadoReserva,
    SolicitudReserva,
    ahora_iso,
)

registrador = logging.getLogger("worker.persistencia.reservas")


class PostgresReservas(ReservaRepositorio):
    def __init__(self, dsn: str, minimo: int = 1, maximo: int = 8) -> None:
        self._pool = ConnectionPool(
            conninfo=dsn,
            min_size=minimo,
            max_size=maximo,
            kwargs={"row_factory": dict_row, "autocommit": True},
            open=True,
        )

    def resolver(
        self,
        solicitud: SolicitudReserva,
        estado: EstadoReserva,
        evento_titulo: str,
        mensaje: str,
        motivo_rechazo: Optional[str],
        pase: Optional[PaseEmitido],
    ) -> ResultadoReserva:
        with self._pool.connection() as conexion, conexion.cursor() as cursor:
            cursor.execute(
                "SELECT reserva_id, estado, ya_existia, codigo_validacion, titular "
                "FROM fn_resolver_reserva(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    solicitud.tracking_id,
                    solicitud.evento_id,
                    evento_titulo,
                    solicitud.estudiante_nombre,
                    solicitud.estudiante_correo,
                    solicitud.canal or "web",
                    estado.value,
                    mensaje,
                    motivo_rechazo,
                    pase.codigo_validacion if pase else None,
                    pase.firma if pase else None,
                ),
            )
            fila = cursor.fetchone()

        if fila is None:
            raise RuntimeError(
                f"fn_resolver_reserva no devolvio fila para {solicitud.tracking_id}"
            )

        pase_persistido = (
            PaseEmitido(
                codigo_validacion=fila["codigo_validacion"],
                firma="",
                titular=fila["titular"] or solicitud.estudiante_nombre,
                evento_id=solicitud.evento_id,
                evento_titulo=evento_titulo,
                emitido_en=ahora_iso(),
            )
            if fila["codigo_validacion"]
            else None
        )

        return ResultadoReserva(
            tracking_id=solicitud.tracking_id,
            reserva_id=str(fila["reserva_id"]),
            evento_id=solicitud.evento_id,
            estado=EstadoReserva(fila["estado"]),
            mensaje=mensaje,
            procesado_en=ahora_iso(),
            evento_titulo=evento_titulo,
            pase=pase_persistido,
            ya_existia=bool(fila["ya_existia"]),
        )

    def contar_por_estado(self) -> dict[str, int]:
        """Metrica util para la evidencia de la practica."""
        with self._pool.connection() as conexion, conexion.cursor() as cursor:
            cursor.execute("SELECT estado, count(*) AS total FROM reserva GROUP BY estado")
            return {f["estado"]: f["total"] for f in cursor.fetchall()}

    def cerrar(self) -> None:
        self._pool.close()
