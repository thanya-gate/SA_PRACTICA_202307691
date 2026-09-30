-- =====================================================================
-- reservas-db  |  Propiedad exclusiva de reservation-worker
-- =====================================================================
-- El servicio productor (reservas-service) NO tiene credenciales sobre
-- esta base: es stateless y su unica salida es el broker. Todo lo que
-- hay aqui lo escribe el worker.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Idempotencia: evita que un reintento del broker cree dos reservas.
-- La clave es el tracking_id que el productor genero en el request.
CREATE TABLE IF NOT EXISTS idempotencia_llave (
    tracking_id  TEXT PRIMARY KEY,
    reserva_id   UUID NOT NULL,
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reserva (
    reserva_id         UUID PRIMARY KEY,
    tracking_id        TEXT        NOT NULL UNIQUE,
    evento_id          TEXT        NOT NULL,
    evento_titulo      TEXT        NOT NULL DEFAULT '',
    estudiante_nombre  TEXT        NOT NULL,
    estudiante_correo  TEXT        NOT NULL,
    estado             TEXT        NOT NULL
                                   CHECK (estado IN ('PENDIENTE','CONFIRMADA','RECHAZADA','SIN_CUPO')),
    mensaje            TEXT        NOT NULL DEFAULT '',
    motivo_rechazo     TEXT,
    canal              TEXT        NOT NULL DEFAULT 'web',
    recibido_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    procesado_en       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reserva_tracking  ON reserva (tracking_id);
CREATE INDEX IF NOT EXISTS idx_reserva_evento    ON reserva (evento_id, estado);
CREATE INDEX IF NOT EXISTS idx_reserva_correo    ON reserva (estudiante_correo, evento_id);

CREATE TABLE IF NOT EXISTS ticket_pase (
    codigo_validacion  TEXT PRIMARY KEY,
    reserva_id         UUID        NOT NULL REFERENCES reserva(reserva_id) ON DELETE CASCADE,
    evento_id          TEXT        NOT NULL,
    firma              TEXT        NOT NULL,
    titular            TEXT        NOT NULL,
    emitido_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    revocado           BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ticket_reserva ON ticket_pase (reserva_id);

-- =====================================================================
-- Operacion de persistencia del worker, atomica y idempotente.
-- =====================================================================
-- Un solo punto de entrada para resolver la reserva. Si el mensaje se
-- redelivera (ACK perdido, worker caido), la funcion detecta que el
-- tracking_id ya fue procesado y devuelve el estado previo sin duplicar.
CREATE OR REPLACE FUNCTION fn_resolver_reserva(
    p_tracking_id        TEXT,
    p_evento_id          TEXT,
    p_evento_titulo      TEXT,
    p_estudiante_nombre  TEXT,
    p_estudiante_correo  TEXT,
    p_canal              TEXT,
    p_estado             TEXT,
    p_mensaje            TEXT,
    p_motivo_rechazo     TEXT,
    p_codigo_validacion  TEXT,
    p_firma              TEXT
) RETURNS TABLE (
    reserva_id        UUID,
    estado            TEXT,
    ya_existia       BOOLEAN,
    codigo_validacion TEXT,
    titular           TEXT,
    -- La firma se devuelve leida de `ticket_pase`, no del parametro de
    -- entrada: si el pase ya existia por una redelivery, lo que vale es la
    -- firma que quedo guardada, no la que trae el mensaje reintentado.
    firma             TEXT
)
-- Esta funcion devuelve `codigo_validacion` como columna de salida y ademas
-- consulta la columna del mismo nombre de `ticket_pase`. Con la regla por
-- defecto PL/pgSQL aborta con "column reference is ambiguous", porque no puede
-- decidir si el nombre es la variable de salida o la columna.
-- `use_column` resuelve la duda a favor de la columna, que es lo unico posible
-- en la inferencia de indice de ON CONFLICT: alli no se puede calificar con el
-- nombre de la tabla, `ON CONFLICT (tabla.columna)` no es sintaxis valida.
SET plpgsql.variable_conflict = 'use_column'
AS $$
DECLARE
    v_reserva    reserva%ROWTYPE;
    v_reserva_id UUID;
    v_ya_existia BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_reserva
      FROM reserva
     WHERE tracking_id = p_tracking_id;

    IF FOUND THEN
        v_ya_existia := TRUE;
        v_reserva_id := v_reserva.reserva_id;
    ELSE
        v_reserva_id := gen_random_uuid();

        INSERT INTO reserva (
            reserva_id, tracking_id, evento_id, evento_titulo,
            estudiante_nombre, estudiante_correo, estado, mensaje,
            motivo_rechazo, canal, procesado_en
        ) VALUES (
            v_reserva_id, p_tracking_id, p_evento_id, p_evento_titulo,
            p_estudiante_nombre, p_estudiante_correo, p_estado, p_mensaje,
            p_motivo_rechazo, p_canal, now()
        )
        ON CONFLICT (tracking_id) DO NOTHING;

        INSERT INTO idempotencia_llave (tracking_id, reserva_id)
        VALUES (p_tracking_id, v_reserva_id)
        ON CONFLICT (tracking_id) DO NOTHING;
    END IF;

    IF p_codigo_validacion IS NOT NULL AND p_codigo_validacion <> '' THEN
        INSERT INTO ticket_pase (
            codigo_validacion, reserva_id, evento_id, firma, titular
        ) VALUES (
            p_codigo_validacion, v_reserva_id, p_evento_id, p_firma,
            p_estudiante_nombre
        )
        ON CONFLICT (codigo_validacion) DO NOTHING;
    END IF;

    RETURN QUERY
    SELECT r.reserva_id,
           r.estado,
           v_ya_existia,
           t.codigo_validacion,
           t.titular,
           t.firma
      FROM reserva r
      LEFT JOIN ticket_pase t ON t.reserva_id = r.reserva_id
     WHERE r.tracking_id = p_tracking_id;
END;
$$ LANGUAGE plpgsql;
