/**
 * Adaptador PostgreSQL de credenciales.
 *
 * SQL crudo parametrizado. Ningun otro servicio escribe en credenciales-db:
 * el worker entra por gRPC, y el verificador publico solo lee.
 */

import { Pool } from 'pg';

import type { CredencialesRepositorio } from '../../../application/ports/credenciales';
import type { Credencial, EmisionPendiente } from '../../../domain/credencial';

interface FilaCredencial {
  codigo: string;
  titulo: string;
  titular: string;
  evento_id: string | null;
  firma: string;
  emitido_en: Date;
  revocada: boolean;
  verificaciones: number;
}

function aCredencial(fila: FilaCredencial): Credencial {
  return {
    codigo: fila.codigo,
    titulo: fila.titulo,
    titular: fila.titular,
    eventoId: fila.evento_id ?? '',
    firma: fila.firma,
    emitidoEn: new Date(fila.emitido_en).toISOString(),
    revocada: fila.revocada,
    verificaciones: fila.verificaciones,
  };
}

export class PostgresCredenciales implements CredencialesRepositorio {
  private readonly pool: Pool;

  constructor(dsn: string, maximo = 5) {
    this.pool = new Pool({ connectionString: dsn, max: maximo, idleTimeoutMillis: 30000 });
  }

  async buscar(codigo: string): Promise<Credencial | null> {
    const { rows } = await this.pool.query<FilaCredencial>(
      `SELECT codigo, titulo, titular, evento_id, firma, emitido_en, revocada, verificaciones
         FROM credencial
        WHERE codigo = $1`,
      [codigo],
    );
    const fila = rows[0];
    return fila ? aCredencial(fila) : null;
  }

  async registrar(emision: EmisionPendiente): Promise<{ registrada: boolean; yaExistia: boolean }> {
    const { rows } = await this.pool.query<{ registrada: boolean; ya_existia: boolean }>(
      'SELECT registrada, ya_existia FROM fn_registrar_credencial($1, $2, $3, $4, $5, $6::uuid)',
      [emision.codigo, emision.titulo, emision.titular, emision.eventoId || null, emision.firma, emision.reservaId],
    );
    return {
      registrada: rows[0]?.registrada ?? false,
      yaExistia: rows[0]?.ya_existia ?? false,
    };
  }

  async registrarVerificacion(codigo: string, resultado: string): Promise<void> {
    await this.pool.query('SELECT fn_registrar_verificacion($1, $2)', [codigo, resultado]);
  }

  async contar(): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>('SELECT count(*) AS total FROM credencial');
    return Number(rows[0]?.total ?? 0);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}
