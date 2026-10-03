/**
 * Caché del catalogo en memoria.
 *
 * Doble de prueba de CacheCatalogo. Permite verificar la logica de
 * invalidacion sin depender de Redis.
 */

import type { CacheCatalogo } from '../../application/ports/catalogo';
import type { EventoDetalle, ResultadoListado } from '../../domain/evento';

export class CacheEnMemoria implements CacheCatalogo {
  readonly listados = new Map<string, ResultadoListado>();
  readonly detalles = new Map<string, EventoDetalle>();
  readonly invalidaciones: string[] = [];
  readonly ttlDeListado: number[] = [];
  readonly ttlDeDetalle: number[] = [];

  async obtenerListado(clave: string): Promise<ResultadoListado | null> {
    return this.listados.get(clave) ?? null;
  }

  async guardarListado(clave: string, valor: ResultadoListado, ttlSegundos: number): Promise<void> {
    this.listados.set(clave, valor);
    this.ttlDeListado.push(ttlSegundos);
  }

  async obtenerDetalle(eventoId: string): Promise<EventoDetalle | null> {
    return this.detalles.get(eventoId) ?? null;
  }

  async guardarDetalle(eventoId: string, valor: EventoDetalle, ttlSegundos: number): Promise<void> {
    this.detalles.set(eventoId, valor);
    this.ttlDeDetalle.push(ttlSegundos);
  }

  async invalidarEvento(eventoId: string): Promise<boolean> {
    this.invalidaciones.push(eventoId);
    return this.detalles.delete(eventoId);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async cerrar(): Promise<void> {
    /* nada que liberar */
  }
}
