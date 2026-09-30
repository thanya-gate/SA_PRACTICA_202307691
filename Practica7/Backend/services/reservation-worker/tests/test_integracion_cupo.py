"""Prueba de integracion de la transaccion atomica de cupo.

Esta prueba no corre en el pipeline unitario: necesita PostgreSQL. Se
ejecuta en el pipeline de CI/CD, donde el servicio postgres ya esta
levantado, y tambien sirve como evidencia de la hoja de calificacion.

    docker compose exec postgres-catalogo ...
    set -a && . ./.env && set +a
    python -m pytest -m integracion

Comprueba el requisito central del enunciado: miles de estudiantes
compiten por el ultimo cupo y solo uno puede ganarlo.
"""

from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

DSN = os.getenv("CATALOGO_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not DSN, reason="requiere CATALOGO_DATABASE_URL apuntando a un PostgreSQL real"
)


@pytest.fixture(scope="module")
def conexion():
    with psycopg.connect(DSN, autocommit=True) as con:
        yield con


def _crear_evento(conexion, cupos: int) -> str:
    evento_id = f"EVT-IT-{uuid.uuid4().hex[:8]}"
    with conexion.cursor() as cur:
        cur.execute(
            "INSERT INTO evento (evento_id, titulo, curso, ponente, correo_ponente,"
            " fecha, modalidad, cupos_totales, cupos_disponibles, estado)"
            " VALUES (%s, 'Evento de integracion', 'Software Avanzado', 'Docente',"
            " 'docente@usac.edu.gt', now(), 'Virtual', %s, %s, 'PROGRAMADO')",
            (evento_id, cupos, cupos),
        )
    return evento_id


def _borrar_evento(conexion, evento_id: str) -> None:
    with conexion.cursor() as cur:
        cur.execute("DELETE FROM evento WHERE evento_id = %s", (evento_id,))


@pytest.fixture
def evento_de_prueba(conexion):
    evento_id = _crear_evento(conexion, cupos=1)
    yield evento_id
    _borrar_evento(conexion, evento_id)


@pytest.fixture
def evento_con_dos_cupos(conexion):
    """Evento con dos plazas.

    Necesario para probar el rechazo de `reserva_id` duplicado: con una sola
    plaza la funcion retorna SIN_CUPO en su guardia inicial y nunca llega al
    INSERT que detecta el duplicado, asi que la excepcion no se dispararia.
    """
    evento_id = _crear_evento(conexion, cupos=2)
    yield evento_id
    _borrar_evento(conexion, evento_id)


def _reclamar(dsn: str, evento_id: str, resultado: dict, indice: int) -> None:
    """Cada hilo abre su propia conexion, como lo hacen servicios distintos."""
    reserva_id = str(uuid.uuid4())
    with psycopg.connect(dsn, autocommit=True) as con, con.cursor() as cur:
        cur.execute(
            "SELECT resultado, cupos_disponibles FROM fn_reclamar_cupo(%s, %s, %s)",
            (evento_id, reserva_id, f"TRK-{indice}"),
        )
        fila = cur.fetchone()
        resultado[indice] = fila[0]


def test_un_solo_concurrente_gana_el_ultimo_cupo(
    conexion, evento_de_prueba
) -> None:
    """50 hilos compiten por 1 plaza: exactamente uno obtiene CUPO_ASIGNADO."""
    concurrentes = 50
    resultados: dict[int, str] = {}

    with ThreadPoolExecutor(max_workers=concurrentes) as pool:
        list(
            pool.map(
                lambda i: _reclamar(DSN, evento_de_prueba, resultados, i),
                range(concurrentes),
            )
        )

    asignados = [v for v in resultados.values() if v == "CUPO_ASIGNADO"]
    sin_cupo = [v for v in resultados.values() if v == "SIN_CUPO"]

    assert len(asignados) == 1, (
        f"solo un estudiante puede ganar el ultimo cupo; asignados={len(asignados)}"
    )
    assert len(sin_cupo) == concurrentes - 1
    assert len(resultados) == concurrentes, "todos los hilos deben responder"


def test_el_contador_de_cupos_nunca_queda_negativo(conexion, evento_de_prueba) -> None:
    for i in range(5):
        _reclamar(DSN, evento_de_prueba, {}, i)

    with conexion.cursor() as cur:
        cur.execute(
            "SELECT cupos_disponibles FROM evento WHERE evento_id = %s", (evento_de_prueba,)
        )
        assert cur.fetchone()[0] == 0


def test_liberar_cupo_devuelve_la_plaza(conexion, evento_de_prueba) -> None:
    reserva_id = str(uuid.uuid4())
    with conexion.cursor() as cur:
        cur.execute(
            "INSERT INTO cupo_ocupado (reserva_id, evento_id, tracking_id)"
            " VALUES (%s, %s, 'TRK-LIB')",
            (reserva_id, evento_de_prueba),
        )
        cur.execute(
            "UPDATE evento SET cupos_disponibles = 0 WHERE evento_id = %s",
            (evento_de_prueba,),
        )
        cur.execute(
            "SELECT liberado, cupos_disponibles FROM fn_liberar_cupo(%s, %s)",
            (evento_de_prueba, reserva_id),
        )
        liberado, disponibles = cur.fetchone()

    assert liberado is True
    assert disponibles == 1


def test_un_reserva_id_duplicado_falla_y_no_descuenta_dos_veces(
    conexion, evento_con_dos_cupos
) -> None:
    """El mismo reserva_id no puede consumir dos cupos.

    La primera llamada gana una de las dos plazas. La segunda repite el mismo
    reserva_id (el escenario de un worker que reintenta tras un ACK perdido):
    el INSERT en `cupo_ocupado` choca con la clave primaria, la funcion aborta
    y el contador se queda en 1, no en 0.
    """
    evento_id = evento_con_dos_cupos
    reserva_id = str(uuid.uuid4())
    with conexion.cursor() as cur:
        cur.execute(
            "SELECT resultado, cupos_disponibles FROM fn_reclamar_cupo(%s, %s, 'TRK-DUP')",
            (evento_id, reserva_id),
        )
        resultado, disponibles = cur.fetchone()
        assert resultado == "CUPO_ASIGNADO"
        assert disponibles == 1

        with pytest.raises(psycopg.errors.RaiseException):
            cur.execute(
                "SELECT resultado FROM fn_reclamar_cupo(%s, %s, 'TRK-DUP')",
                (evento_id, reserva_id),
            )

    with conexion.cursor() as cur:
        cur.execute(
            "SELECT cupos_disponibles FROM evento WHERE evento_id = %s", (evento_id,)
        )
        assert cur.fetchone()[0] == 1, "el reintento no debe descontar un segundo cupo"
