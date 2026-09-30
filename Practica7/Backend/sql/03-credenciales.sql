-- =====================================================================
-- credenciales-db  |  Propiedad exclusiva de certificados-service
-- =====================================================================
-- Solo lectura desde el punto de vista del verificador publico.
-- Las filas las registra reservation-worker via gRPC al emitir el pase.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS credencial (
    codigo         TEXT PRIMARY KEY,
    titulo         TEXT        NOT NULL,
    titular        TEXT        NOT NULL,
    evento_id      TEXT,
    firma          TEXT        NOT NULL,
    emitido_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    verificaciones INTEGER     NOT NULL DEFAULT 0,
    revocada       BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_credencial_titular ON credencial (titular);

-- Contador de verificaciones por codigo (auditoria del servicio).
CREATE TABLE IF NOT EXISTS verificacion_auditoria (
    verificacion_id BIGSERIAL PRIMARY KEY,
    codigo          TEXT NOT NULL,
    resultado       TEXT NOT NULL,
    verificada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fn_registrar_credencial(
    p_codigo     TEXT,
    p_titulo     TEXT,
    p_titular    TEXT,
    p_evento_id  TEXT,
    p_firma      TEXT,
    p_reserva_id UUID
) RETURNS TABLE (
    registrada   BOOLEAN,
    ya_existia   BOOLEAN
) AS $$
DECLARE
    v_exISTIA BOOLEAN;
BEGIN
    SELECT TRUE INTO v_exISTIA FROM credencial WHERE codigo = p_codigo;

    INSERT INTO credencial (codigo, titulo, titular, evento_id, firma)
    VALUES (p_codigo, p_titulo, p_titular, p_evento_id, p_firma)
    ON CONFLICT (codigo) DO NOTHING;

    RETURN QUERY SELECT TRUE, v_exISTIA;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_registrar_verificacion(
    p_codigo   TEXT,
    p_resultado TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO verificacion_auditoria (codigo, resultado)
    VALUES (p_codigo, p_resultado);

    UPDATE credencial
       SET verificaciones = verificaciones + 1
     WHERE codigo = p_codigo;
END;
$$ LANGUAGE plpgsql;

-- Semilla: credencial de cortesia para poder probar el flujo antes de
-- que un estudiante registre su primer pase.
INSERT INTO credencial (codigo, titulo, titular, evento_id, firma)
VALUES ('CERT-2026-000742', 'Asistencia a taller de Arquitectura de Microservicios',
        'Estudiante Demo', 'EVT-2026-001', 'demo-firma-no-verificable')
ON CONFLICT (codigo) DO NOTHING;
