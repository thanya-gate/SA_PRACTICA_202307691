/**
 * Contratos del backend y traduccion al modelo que usa la interfaz.
 *
 * Los tres servicios responden en el vocabulario del dominio (español:
 * `titulo`, `cuposDisponibles`, `estado`) y las enumeraciones viajan como
 * numeros, porque son las del .proto. Este archivo es el unico lugar donde se
 * conoce esa forma: si manana catalogo-service renombra una columna, el cambio
 * queda aca y ningun componente se entera.
 *
 * La traduccion va en un solo sentido. El modelo de la interfaz
 * (`@/lib/types`) no menciona HTTP, y por eso las pruebas de componentes
 * pueden seguir usando datos planos sin necesitar la VM.
 */

import type {
  CredentialStatus,
  CredentialVerification,
  EventDetail,
  EventSummary,
  ReservationStatus,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Servicio de Catalogo de Talleres                                     */
/* ------------------------------------------------------------------ */

/** GET /api/talleres/eventos */
interface ListadoEventosDTO {
  eventos: EventoResumenDTO[];
  total: number;
  origenCache: boolean;
}

interface EventoResumenDTO {
  eventoId: string;
  titulo: string;
  curso: string;
  ponente: string;
  fecha: string;
  modalidad: string;
  cuposDisponibles: number;
  cuposTotales: number;
  /** 0 NO_ESPECIFICADO · 1 PROGRAMADO · 2 EN_CURSO · 3 FINALIZADO · 4 CANCELADO */
  estado: number;
}

/** GET /api/talleres/eventos/:eventoId */
interface DetalleEventoDTO {
  evento: EventoDetalleDTO;
  origenCache: boolean;
}

interface EventoDetalleDTO extends EventoResumenDTO {
  correoPonente: string;
  descripcion: string;
  prerrequisitos: string[];
}

/* ------------------------------------------------------------------ */
/* Servicio de Reservas / Ticketing (productor)                         */
/* ------------------------------------------------------------------ */

/** POST /api/reservas -> 202 Accepted */
interface AceptadaDTO {
  trackingId: string;
  estado: string;
  mensaje: string;
  urlSeguimiento: string;
}

/** GET /api/reservas/:trackingId/estado */
interface EstadoReservaDTO {
  trackingId: string;
  reservaId?: string;
  estado: string;
  mensaje: string;
  procesadoEn?: string;
  encontrado: boolean;
  ticket?: TicketDTO;
}

interface TicketDTO {
  ticketId: string;
  codigoValidacion: string;
  firma: string;
  emitidoEn: string;
  eventoTitulo: string;
  titular: string;
}

/* ------------------------------------------------------------------ */
/* Servicio de Certificados                                             */
/* ------------------------------------------------------------------ */

/** GET /api/certificados/verificar?codigo= */
interface VerificacionDTO {
  codigo: string;
  /** 1 VALIDA · 2 INVALIDA · 3 NO_ENCONTRADA */
  estado: number;
  estadoTexto: string;
  titulo: string;
  titular: string;
  emitidoEn: string;
  mensaje: string;
}

/* ------------------------------------------------------------------ */
/* Traducciones                                                         */
/* ------------------------------------------------------------------ */

const ESTADO_EVENTO_A_ETIQUETA: Record<number, string> = {
  0: 'Sin estado',
  1: 'Programado',
  2: 'En curso',
  3: 'Finalizado',
  4: 'Cancelado',
};

const ESTADO_CREDENCIAL_A_ETIQUETA: Record<number, CredentialStatus> = {
  1: 'VÁLIDA',
  2: 'INVÁLIDA',
  3: 'NO_ENCONTRADA',
};

const ESTADOS_RESERVA: readonly ReservationStatus[] = [
  'PENDIENTE',
  'CONFIRMADA',
  'RECHAZADA',
  'SIN_CUPO',
];

export function esEstadoReserva(valor: string): valor is ReservationStatus {
  return (ESTADOS_RESERVA as readonly string[]).includes(valor);
}

/**
 * La fecha del catalogo llega en ISO 8601 (`2026-10-05T15:00:00Z`). Se
 * formatea a `05/10/2026 · 15:00` porque es lo que espera la interfaz, y se
 * degrada al texto original si el valor no es una fecha valida: mostrar
 * "Invalid Date" en una tarjeta es peor que mostrar la cadena cruda.
 */
export function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;

  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anio = fecha.getFullYear();
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} · ${hora}:${minuto}`;
}

export function aResumen(dto: EventoResumenDTO): EventSummary & { state: string } {
  return {
    eventId: dto.eventoId,
    title: dto.titulo,
    course: dto.curso,
    speaker: dto.ponente,
    date: formatearFecha(dto.fecha),
    modality: dto.modalidad,
    availableSeats: dto.cuposDisponibles,
    totalSeats: dto.cuposTotales,
    state: ESTADO_EVENTO_A_ETIQUETA[dto.estado] ?? 'Sin estado',
  };
}

export function aDetalle(dto: EventoDetalleDTO): EventDetail & { speakerEmail: string; state: string } {
  return {
    ...aResumen(dto),
    speakerEmail: dto.correoPonente,
    description: dto.descripcion,
    prerequisites: dto.prerrequisitos ?? [],
  };
}

export function aListado(dto: ListadoEventosDTO): {
  eventos: (EventSummary & { state: string })[];
  total: number;
  origenCache: boolean;
} {
  return {
    eventos: (dto.eventos ?? []).map(aResumen),
    total: dto.total ?? 0,
    origenCache: Boolean(dto.origenCache),
  };
}

/** El estado de una reserva viaja como texto; el que no exista se degrada a PENDIENTE. */
export function aEstadoReserva(valor: string): ReservationStatus {
  return esEstadoReserva(valor) ? valor : 'PENDIENTE';
}

export function aTicket(dto: TicketDTO | undefined): {
  ticketId: string;
  validationCode: string;
  signature: string;
  issuedAt: string;
  eventTitle: string;
  holder: string;
} | undefined {
  if (!dto) return undefined;
  return {
    ticketId: dto.ticketId,
    validationCode: dto.codigoValidacion,
    signature: dto.firma,
    issuedAt: dto.emitidoEn ? formatearFecha(dto.emitidoEn) : '',
    eventTitle: dto.eventoTitulo,
    holder: dto.titular,
  };
}

export function aCredencial(dto: VerificacionDTO): CredentialVerification {
  return {
    identifier: dto.codigo,
    status: ESTADO_CREDENCIAL_A_ETIQUETA[dto.estado] ?? 'NO_ENCONTRADA',
    title: dto.estado === 1 ? dto.titulo : 'Credencial no encontrada',
    holder: dto.titular,
    issuedAt: dto.emitidoEn ? formatearFecha(dto.emitidoEn) : undefined,
    message: dto.mensaje,
  };
}

export type { AceptadaDTO, DetalleEventoDTO, EstadoReservaDTO, EventoResumenDTO, ListadoEventosDTO, VerificacionDTO };