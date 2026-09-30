/**
 * Adaptador PostgreSQL del catalogo.
 *
 * SQL crudo: no se usa Prisma, TypeORM ni ningun gestor externo, tal como
 * lo exige el enunciado. Las consultas se parametrizan para evitar
 * inyeccion.
 */

import { Pool, type PoolClient } from 'pg';

import type { CatalogoRepositorio, ConsultaEventos } from '../../../application/ports/catalogo';
import {
  type ClaimDeCupo,
  type EventoDetalle,
  type EstadoEvento,
  type ResultadoListado,
  ResultadoCupo,
  admiteReserva,
} from '../../../domain/evento';

interface FilaEvento {
  evento_id: string;
  titulo: string;
  curso: string;
  ponente: string;
  correo_ponente: string;
  fecha: Date;
  modalidad: string;
  descripcion: string;
  cupos_totales: number;
  cupos_disponibles: number;
  estado: EstadoEvento;
}

const SELECCION = `
  SELECT evento_id, titulo, curso, ponente, correo_ponente, fecha, modalidad,
         descripcion, cupos_totales, cupos_disponibles, estado
    FROM evento`;

function aResumen(fila: FilaEvento) {
  return {
    eventoId: fila.evento_id,
    titulo: fila.titulo,
    curso: fila.curso,
    ponente: fila.ponente,
    fecha: new Date(fila.fecha).toISOString(),
    modalidad: fila.modalidad,
    cuposDisponibles: fila.cupos_disponibles,
    cuposTotales: fila.cupos_totales,
    estado: fila.estado,
  };
}

export class PostgresCatalogo implements CatalogoRepositorio {
  private readonly pool: Pool;

  constructor(dsn: string, maximo = 10) {
    this.pool = new Pool({ connectionString: dsn, max: maximo, idleTimeoutMillis: 30000 });
  }

  async listar(consulta: ConsultaEventos): Promise<ResultadoListado> {
    const condiciones: string[] = ["estado <> 'CANCELADO'"];
    const valores: unknown[] = [];

    if (consulta.busqueda.trim()) {
      const patron = `%${consulta.busqueda.trim()}%`;
      valores.push(patron);
      const indice = valores.length;
      condiciones.push(
        `(titulo ILIKE $${indice} OR curso ILIKE $${indice} OR ponente ILIKE $${indice})`,
      );
    }

    if (consulta.soloConCupo) {
      condiciones.push('cupos_disponibles > 0');
    }

    const where = `WHERE ${condiciones.join(' AND ')}`;

    const total = await this.pool.query<{ total: string }>(`SELECT count(*) AS total FROM evento ${where}`, valores);

    valores.push(consulta.limite, consulta.offset);
    const filas = await this.pool.query<FilaEvento>(
      `${SELECCION} ${where} ORDER BY fecha ASC LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
      valores,
    );

    return {
      eventos: filas.rows.map(aResumen),
      total: Number(total.rows[0]?.total ?? 0),
      origenCache: false,
    };
  }

  async obtener(eventoId: string): Promise<EventoDetalle | null> {
    const { rows } = await this.pool.query<FilaEvento>(`${SELECCION} WHERE evento_id = $1`, [eventoId]);
    const fila = rows[0];
    if (!fila) return null;

    const prerrequisitos = await this.pool.query<{ descripcion: string }>(
      'SELECT descripcion FROM evento_prerrequisito WHERE evento_id = $1 ORDER BY orden',
      [eventoId],
    );

    return {
      ...aResumen(fila),
      correoPonente: fila.correo_ponente,
      descripcion: fila.descripcion,
      prerrequisitos: prerrequisitos.rows.map((r) => r.descripcion),
    };
  }

  async validar(eventoId: string) {
    const { rows } = await this.pool.query<{ estado: EstadoEvento; titulo: string }>(
      'SELECT estado, titulo FROM evento WHERE evento_id = $1',
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) {
      return { existe: false, admite: false, estado: '', titulo: '' };
    }
    return {
      existe: true,
      admite: admiteReserva(fila.estado),
      estado: fila.estado,
      titulo: fila.titulo,
    };
  }

  async consultarDisponibilidad(eventoId: string) {
    const { rows } = await this.pool.query<{ cupos_disponibles: number; cupos_totales: number; estado: EstadoEvento }>(
      'SELECT cupos_disponibles, cupos_totales, estado FROM evento WHERE evento_id = $1',
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) {
      return { disponibles: 0, totales: 0, admite: false };
    }
    return {
      disponibles: fila.cupos_disponibles,
      totales: fila.cupos_totales,
      admite: admiteReserva(fila.estado),
    };
  }

  /**
   * Delega en fn_reclamar_cupo. Esa funcion abre la transaccion, bloquea la
   * fila con FOR UPDATE, descuenta el cupo y registra el asiento en
   * cupo_ocupado. Aqui no hay ninguna logica de concurrencia: toda la
   * garantia esta en una sola sentencia de PostgreSQL.
   */
  async reclamarCupo(eventoId: string, reservaId: string, trackingId: string): Promise<ClaimDeCupo> {
    const cliente: PoolClient = await this.pool.connect();
    try {
      const { rows } = await cliente.query<{ resultado: string; cupos_disponibles: number; cupos_totales: number; titulo: string | null }>(
        'SELECT resultado, cupos_disponibles, cupos_totales, titulo FROM fn_reclamar_cupo($1, $2::uuid, $3)',
        [eventoId, reservaId, trackingId],
      );
      const fila = rows[0];
      return {
        resultado: (fila?.resultado ?? 'EVENTO_INEXISTENTE') as ResultadoCupo,
        cuposDisponibles: fila?.cupos_disponibles ?? 0,
        cuposTotales: fila?.cupos_totales ?? 0,
        titulo: fila?.titulo ?? '',
        mensaje: '',
      };
    } finally {
      cliente.release();
    }
  }

  async liberarCupo(eventoId: string, reservaId: string): Promise<number> {
    const { rows } = await this.pool.query<{ liberado: boolean; cupos_disponibles: number }>(
      'SELECT liberado, cupos_disponibles FROM fn_liberar_cupo($1, $2::uuid)',
      [eventoId, reservaId],
    );
    return rows[0]?.cupos_disponibles ?? 0;
  }

  async contarEventos(): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>("SELECT count(*) AS total FROM evento WHERE estado <> 'CANCELADO'");
    return Number(rows[0]?.total ?? 0);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async cerrar(): Promise<void> {
    await this.pool.end();
  }
}
