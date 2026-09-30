-- =====================================================================
-- catalog-db  |  Propiedad exclusiva de catalogo-service
-- =====================================================================
-- Este script se monta en /docker-entrypoint-initdb.d del contenedor
-- postgres-catalogo. Ningun otro servicio escribe en esta base.
-- Prohibido usar ORM o gestor BaaS: se aplica SQL crudo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS evento (
    evento_id        TEXT PRIMARY KEY,
    titulo           TEXT        NOT NULL,
    curso            TEXT        NOT NULL,
    ponente          TEXT        NOT NULL,
    correo_ponente   TEXT        NOT NULL,
    fecha            TIMESTAMPTZ NOT NULL,
    modalidad        TEXT        NOT NULL,
    descripcion      TEXT        NOT NULL DEFAULT '',
    cupos_totales    INTEGER     NOT NULL CHECK (cupos_totales >= 0),
    cupos_disponibles INTEGER    NOT NULL CHECK (cupos_disponibles >= 0),
    estado           TEXT        NOT NULL DEFAULT 'PROGRAMADO'
                               CHECK (estado IN ('PROGRAMADO','EN_CURSO','FINALIZADO','CANCELADO')),
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_cupos_coherentes CHECK (cupos_disponibles <= cupos_totales)
);

CREATE TABLE IF NOT EXISTS evento_prerrequisito (
    evento_id    TEXT NOT NULL REFERENCES evento(evento_id) ON DELETE CASCADE,
    orden        SMALLINT NOT NULL,
    descripcion  TEXT NOT NULL,
    PRIMARY KEY (evento_id, orden)
);

-- Libro mayor de cupos ocupados. Permite auditar cuantas reservas
-- escribieron el descuento de cupo_disponibles.
CREATE TABLE IF NOT EXISTS cupo_ocupado (
    reserva_id    UUID PRIMARY KEY,
    evento_id     TEXT        NOT NULL REFERENCES evento(evento_id) ON DELETE CASCADE,
    tracking_id   TEXT        NOT NULL,
    ocupado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evento_estado ON evento (estado);
CREATE INDEX IF NOT EXISTS idx_evento_fecha  ON evento (fecha);
CREATE INDEX IF NOT EXISTS idx_cupo_ocupado_evento ON cupo_ocupado (evento_id);

-- =====================================================================
-- Transaccion atomica de cupo (el requisito central de la practica).
-- =====================================================================
-- Se ejecuta como UNA sola sentencia. Postgres evalua el WHERE sobre la
-- version de fila que Blochquea con un lock de fila (modo UPDATE). Si dos
-- workers compiten por el ultimo cupo, el segundo ve cupos_disponibles = 0
-- y la sentencia no modifica nada -> resultado 0 filas -> SIN_CUPO.
-- No hay lectura previa, no hay ventana entre "leer" y "escribir".
CREATE OR REPLACE FUNCTION fn_reclamar_cupo(
    p_evento_id   TEXT,
    p_reserva_id  UUID,
    p_tracking_id TEXT
) RETURNS TABLE (
    resultado          TEXT,
    cupos_disponibles  INTEGER,
    cupos_totales      INTEGER,
    titulo             TEXT
) AS $$
DECLARE
    v_evento   evento%ROWTYPE;
    v_inserted BOOLEAN;
BEGIN
    SELECT * INTO v_evento
      FROM evento
     WHERE evento_id = p_evento_id
       AND estado IN ('PROGRAMADO', 'EN_CURSO')
     FOR UPDATE;

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM evento WHERE evento_id = p_evento_id) THEN
            RETURN QUERY SELECT 'EVENTO_CERRADO', 0, 0, NULL::TEXT;
        ELSE
            RETURN QUERY SELECT 'EVENTO_INEXISTENTE', 0, 0, NULL::TEXT;
        END IF;
        RETURN;
    END IF;

    IF v_evento.cupos_disponibles <= 0 THEN
        RETURN QUERY SELECT 'SIN_CUPO', 0, v_evento.cupos_totales, v_evento.titulo;
        RETURN;
    END IF;

    -- Las columnas se califican con el nombre de la tabla a proposito: la
    -- funcion declara `cupos_disponibles` entre sus columnas de salida, y sin
    -- el prefijo PL/pgSQL no puede decidir si el nombre es la variable de
    -- salida o la columna, y falla con "column reference is ambiguous".
    UPDATE evento
       SET cupos_disponibles = evento.cupos_disponibles - 1
     WHERE evento_id = p_evento_id;

    INSERT INTO cupo_ocupado (reserva_id, evento_id, tracking_id)
    VALUES (p_reserva_id, p_evento_id, p_tracking_id)
    ON CONFLICT (reserva_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF NOT v_inserted THEN
        RAISE EXCEPTION 'reserva duplicada en cupo_ocupado: %', p_reserva_id;
    END IF;

    RETURN QUERY SELECT 'CUPO_ASIGNADO',
                        v_evento.cupos_disponibles - 1,
                        v_evento.cupos_totales,
                        v_evento.titulo;
END;
$$ LANGUAGE plpgsql;

-- Devolucion de cupo cuando el worker detecta una reserva invalida
-- despues de haber reclamado el cupo (por ejemplo, persistencia fallida).
-- La fila de `cupo_ocupado` es la fuente de verdad del evento: si el DELETE no
-- devuelve nada, la reserva nunca ocupo un cupo y no hay nada que devolver.
CREATE OR REPLACE FUNCTION fn_liberar_cupo(
    p_evento_id  TEXT,
    p_reserva_id UUID
) RETURNS TABLE (
    liberado           BOOLEAN,
    cupos_disponibles  INTEGER
) AS $$
DECLARE
    -- Locales propios en lugar de reutilizar los parametros de entrada: antes
    -- el `INTO p_evento_id` sobrescribia el argumento, dejando la funcion con
    -- un parametro de entrada mutado al final.
    v_evento_id   TEXT;
    v_disponibles INTEGER;
BEGIN
    DELETE FROM cupo_ocupado
     WHERE reserva_id = p_reserva_id
     RETURNING evento_id INTO v_evento_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0;
        RETURN;
    END IF;

    -- Columnas calificadas con el nombre de la tabla: `cupos_disponibles`
    -- tambien es una columna de salida de esta funcion (ver fn_reclamar_cupo).
    UPDATE evento
       SET cupos_disponibles = LEAST(evento.cupos_totales,
                                      evento.cupos_disponibles + 1)
     WHERE evento_id = v_evento_id
     RETURNING evento.cupos_disponibles INTO v_disponibles;

    RETURN QUERY SELECT TRUE, v_disponibles;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Semilla
-- =====================================================================
INSERT INTO evento (evento_id, titulo, curso, ponente, correo_ponente, fecha,
                    modalidad, descripcion, cupos_totales, cupos_disponibles, estado)
VALUES
 ('EVT-2026-001', 'Arquitectura de microservicios con eventos',
  'Software Avanzado', 'Ing. Thanya Vargas',
  'thanya.vargas@usac.edu.gt', '2026-10-05T15:00:00Z', 'Presencial',
  'Taller practico sobre contratos protobuf, brokers y despliegue inmutable.',
  40, 40, 'PROGRAMADO'),
 ('EVT-2026-002', 'Observabilidad y trazabilidad distribuida',
  'Software Avanzado', 'Ing. Carlos Recinos',
  'carlos.recinos@usac.edu.gt', '2026-10-12T15:00:00Z', 'Hibrida',
  'Metricas, logs correlacionados y trazas distribuidas en contenedores.',
  25, 25, 'PROGRAMADO'),
 ('EVT-2026-003', 'Concurrencia y colas de mensajes',
  'Software Avanzado', 'Ing. Thanya Vargas',
  'thanya.vargas@usac.edu.gt', '2026-10-19T15:00:00Z', 'Virtual',
  'Patrones de productor-consumidor, confirmaciones de entrega y reintentos.',
  3, 3, 'PROGRAMADO'),
 ('EVT-2026-004', 'CI/CD y despliegue inmutable en VM',
  'Software Avanzado', 'Ing. Maria Estrada',
  'maria.estrada@usac.edu.gt', '2026-10-26T15:00:00Z', 'Virtual',
  'Pipelines de GitHub Actions, registry y Actualizacion sin build en el host.',
  50, 50, 'PROGRAMADO')
ON CONFLICT (evento_id) DO NOTHING;

INSERT INTO evento_prerrequisito (evento_id, orden, descripcion) VALUES
 ('EVT-2026-002', 1, 'Haber aprobado el taller de Arquitectura de microservicios.'),
 ('EVT-2026-003', 1, 'Haber aprobado el taller de Arquitectura de microservicios.'),
 ('EVT-2026-004', 1, 'Haber aprobado el taller de Concurrencia y colas de mensajes.')
ON CONFLICT DO NOTHING;
