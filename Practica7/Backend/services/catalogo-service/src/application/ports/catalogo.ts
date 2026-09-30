/**
 * Puertos del Servicio de Catalogo.
 *
 * La aplicacion depende solo de estas interfaces. Los adaptadores de
 * PostgreSQL y Redis las implementan, lo que permite prueban con dobles en
 * memoria y aplica el principio de inversion de dependencias.
 */

import {
  type ClaimDeCupo,
  type EventoDetalle,
  type ResultadoListado,
} from '../../domain/evento';

export interface ConsultaEventos {
  busqueda: string;
  limite: number;
  offset: number;
  soloConCupo: boolean;
}

export interface CatalogoRepositorio {
  listar(consulta: ConsultaEventos): Promise<ResultadoListado>;
  obtener(eventoId: string): Promise<EventoDetalle | null>;
  validar(eventoId: string): Promise<{ existe: boolean; admite: boolean; estado: string; titulo: string }>;
  consultarDisponibilidad(eventoId: string): Promise<{ disponibles: number; totales: number; admite: boolean }>;
  /** Transaccion atomica que descuenta un cupo. Ver 01-catalogo.sql. */
  reclamarCupo(eventoId: string, reservaId: string, trackingId: string): Promise<ClaimDeCupo>;
  liberarCupo(eventoId: string, reservaId: string): Promise<number>;
  contarEventos(): Promise<number>;
  ping(): Promise<void>;
}

export interface CacheCatalogo {
  obtenerListado(clave: string): Promise<ResultadoListado | null>;
  guardarListado(clave: string, valor: ResultadoListado, ttlSegundos: number): Promise<void>;
  obtenerDetalle(eventoId: string): Promise<EventoDetalle | null>;
  guardarDetalle(eventoId: string, valor: EventoDetalle, ttlSegundos: number): Promise<void>;
  invalidarEvento(eventoId: string): Promise<boolean>;
  ping(): Promise<boolean>;
  cerrar(): Promise<void>;
}

export interface Reloj {
  ahora(): number;
}
