/**
 * Adaptador de Redis para el catalogo.
 *
 * Redis es obligatorio en la practica y aqui cumple un papel concreto: el
 * catalogo se consulta desde el navegador en cada apertura de pagina y el
 * numero de cupos cambia varias veces por segundo. Sin cache, cada visita
 * golpearia PostgreSQL justo cuando el sistema esta mas cargado.
 *
 * TTL corto (15-30 s) porque un dato desactualizado por medio minuto es
 * aceptable para el catalogo, y el worker invalida la entrada en cuanto
 * cambia un cupo.
 */

import Redis from 'ioredis';

import type { CacheCatalogo } from '../../application/ports/catalogo';
import type { EventoDetalle, ResultadoListado } from '../../domain/evento';

const PREFIJO_LISTADO = 'academix:catalogo:listado:';
const PREFIJO_DETALLE = 'academix:catalogo:evento:';

export class RedisCatalogo implements CacheCatalogo {
  private readonly cliente: Redis;

  constructor(url: string) {
    this.cliente = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (intentos) => Math.min(intentos * 200, 2000),
    });
    this.cliente.on('error', (error) => {
      // La cache nunca debe tumbar el servicio: si Redis cae, el catalogo
      // sigue respondiendo leyendo de PostgreSQL.
      console.warn('[cache] redis no disponible:', error.message);
    });
  }

  async obtenerListado(clave: string): Promise<ResultadoListado | null> {
    return this.leerJson<ResultadoListado>(PREFIJO_LISTADO + clave);
  }

  async guardarListado(clave: string, valor: ResultadoListado, ttlSegundos: number): Promise<void> {
    await this.escribirJson(PREFIJO_LISTADO + clave, valor, ttlSegundos);
  }

  async obtenerDetalle(eventoId: string): Promise<EventoDetalle | null> {
    return this.leerJson<EventoDetalle>(PREFIJO_DETALLE + eventoId);
  }

  async guardarDetalle(eventoId: string, valor: EventoDetalle, ttlSegundos: number): Promise<void> {
    await this.escribirJson(PREFIJO_DETALLE + eventoId, valor, ttlSegundos);
  }

  async invalidarEvento(eventoId: string): Promise<boolean> {
    try {
      const resultado = await this.cliente.del(PREFIJO_DETALLE + eventoId);
      return resultado > 0;
    } catch {
      return false;
    }
  }

  /** El listado cambia cuando cambia cualquier cupo: se invalida entero. */
  async invalidarListados(): Promise<void> {
    try {
      const claves = await this.cliente.keys(`${PREFIJO_LISTADO}*`);
      if (claves.length > 0) {
        await this.cliente.del(...claves);
      }
    } catch {
      // sin cache, el catalogo responde igual desde PostgreSQL
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.cliente.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async cerrar(): Promise<void> {
    await this.cliente.quit().catch(() => this.cliente.disconnect());
  }

  private async leerJson<T>(clave: string): Promise<T | null> {
    try {
      const crudo = await this.cliente.get(clave);
      return crudo ? (JSON.parse(crudo) as T) : null;
    } catch {
      return null;
    }
  }

  private async escribirJson(clave: string, valor: unknown, ttlSegundos: number): Promise<void> {
    try {
      await this.cliente.set(clave, JSON.stringify(valor), 'EX', ttlSegundos);
    } catch {
      // sin cache, el catalogo responde igual desde PostgreSQL
    }
  }
}
