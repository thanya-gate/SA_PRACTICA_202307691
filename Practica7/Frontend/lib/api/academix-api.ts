/**
 * Adaptadores de salida hacia la malla SOA de la Maquina Virtual.
 *
 * Un modulo por servicio. Cada funcion corresponde a un caso de uso y devuelve
 * el modelo de la interfaz, ya traducido. Ningun componente conoce rutas,
 * puertos ni nombres de campo del backend.
 *
 * El caso de uso CU-P7-03 es el unico asincrono de verdad: `solicitarReserva`
 * devuelve 202 Accepted con un identificador de seguimiento, y el resultado
 * final lo escribe el worker. El frontend nunca espera a la base de datos.
 */

import { pedir, exigir, type RequestOptions } from './http';
import {
  aCredencial,
  aDetalle,
  aEstadoReserva,
  aListado,
  aTicket,
  type AceptadaDTO,
  type DetalleEventoDTO,
  type EstadoReservaDTO,
  type ListadoEventosDTO,
  type VerificacionDTO,
} from './contratos';
import { apiConfig } from '@/lib/config';
import type { CredentialVerification, EventDetail, EventSummary } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Servicio de Catalogo de Talleres                                     */
/* ------------------------------------------------------------------ */

export type EventoResumen = EventSummary & { state: string };
export type EventoCompleto = EventDetail & { speakerEmail: string; state: string };

export interface ResultadoListado {
  eventos: EventoResumen[];
  total: number;
  origenCache: boolean;
}

/** CU-P7-01: consultar el catalogo de eventos. El filtro lo aplica el servicio. */
export async function listarEventos(
  busqueda = '',
  opciones: RequestOptions = {},
): Promise<ResultadoListado> {
  const parametros = new URLSearchParams({ busqueda: busqueda.trim(), limite: '50' });
  const dto = await pedir<ListadoEventosDTO>(
    apiConfig.catalogo,
    `/api/talleres/eventos?${parametros.toString()}`,
    opciones,
  );
  return aListado(exigir(dto, 'El Servicio de Catalogo devolvio una respuesta vacia.'));
}

/** CU-P7-02: consultar el detalle y los prerrequisitos de un evento. */
export async function obtenerEvento(eventoId: string, opciones: RequestOptions = {}): Promise<EventoCompleto> {
  const id = encodeURIComponent(eventoId.trim());
  const dto = await pedir<DetalleEventoDTO>(
    apiConfig.catalogo,
    `/api/talleres/eventos/${id}`,
    opciones,
  );
  return aDetalle(
    exigir(dto?.evento, 'El Servicio de Catalogo devolvio una respuesta sin el evento.'),
  );
}

/** CU-P7-02: disponibilidad en vivo, usada para refrescar el detalle. */
export async function consultarDisponibilidad(
  eventoId: string,
  opciones: RequestOptions = {},
): Promise<{ disponibles: number; total: number; admiteReserva: boolean }> {
  const id = encodeURIComponent(eventoId.trim());
  const dto = await pedir<{
    eventoId: string;
    disponibles: number;
    totales: number;
    admite: boolean;
  }>(apiConfig.catalogo, `/api/talleres/eventos/${id}/disponibilidad`, opciones);
  return {
    disponibles: Number(dto.disponibles ?? 0),
    total: Number(dto.totales ?? 0),
    admiteReserva: Boolean(dto.admite),
  };
}

/* ------------------------------------------------------------------ */
/* Servicio de Reservas / Ticketing (productor)                         */
/* ------------------------------------------------------------------ */

export interface SolicitudAceptada {
  trackingId: string;
  status: 'PENDIENTE';
  message: string;
  followUpUrl: string;
}

/**
 * CU-P7-03: publica la solicitud y devuelve el identificador de seguimiento.
 *
 * El 202 no significa "reserva confirmada": significa "la solicitud esta en la
 * cola". Por eso el tipo devuelto solo admite PENDIENTE; el resultado final se
 * obtiene despues con `consultarEstado`.
 */
export async function solicitarReserva(
  entrada: { eventId: string; studentName: string; studentEmail: string },
  opciones: RequestOptions = {},
): Promise<SolicitudAceptada> {
  const dto = await pedir<AceptadaDTO>(apiConfig.reservas, '/api/reservas', {
    ...opciones,
    method: 'POST',
    body: {
      eventoId: entrada.eventId,
      estudianteNombre: entrada.studentName,
      estudianteCorreo: entrada.studentEmail,
      canal: 'web',
    },
  });

  const aceptada = exigir(dto, 'El productor no devolvio el identificador de seguimiento.');
  return {
    trackingId: exigir(
      aceptada.trackingId,
      'El productor acepto la solicitud pero no devolvio el identificador de seguimiento.',
    ),
    status: 'PENDIENTE',
    message: aceptada.mensaje,
    followUpUrl: aceptada.urlSeguimiento,
  };
}

export interface SeguimientoReserva {
  trackingId: string;
  reservationId?: string;
  status: ReturnType<typeof aEstadoReserva>;
  message: string;
  processedAt?: string;
  /** false mientras el worker todavia no ha escrito el resultado. */
  resolved: boolean;
  ticket?: {
    ticketId: string;
    validationCode: string;
    signature: string;
    issuedAt: string;
    eventTitle: string;
    holder: string;
  };
}

/**
 * CU-P7-04: lee el estado desde la cache de seguimiento del productor. Nunca
 * toca la base de datos, asi que se puede repetir cada dos segundos mientras
 * el worker procesa la cola sin generar contencion.
 */
export async function consultarEstado(
  trackingId: string,
  opciones: RequestOptions = {},
): Promise<SeguimientoReserva> {
  const id = encodeURIComponent(trackingId.trim());
  const dto = await pedir<EstadoReservaDTO>(
    apiConfig.reservas,
    `/api/reservas/${id}/estado`,
    opciones,
  );
  const respuesta = exigir(dto, 'El productor devolvio una respuesta vacia.');

  return {
    trackingId: respuesta.trackingId,
    reservationId: respuesta.reservaId,
    status: aEstadoReserva(respuesta.estado),
    message: respuesta.mensaje,
    processedAt: respuesta.procesadoEn,
    resolved: Boolean(respuesta.encontrado),
    ticket: aTicket(respuesta.ticket),
  };
}

/** Contadores del productor: publicados contra confirmados por el broker. */
export async function obtenerMetricas(opciones: RequestOptions = {}): Promise<{
  publicadas: number;
  confirmadasBroker: number;
  rechazadasBroker: number;
  duplicadas: number;
}> {
  const dto = await pedir<{
    publicadas: number;
    confirmadasBroker: number;
    rechazadasBroker: number;
    duplicadas: number;
  }>(apiConfig.reservas, '/api/reservas/metricas', opciones);
  return {
    publicadas: Number(dto.publicadas ?? 0),
    confirmadasBroker: Number(dto.confirmadasBroker ?? 0),
    rechazadasBroker: Number(dto.rechazadasBroker ?? 0),
    duplicadas: Number(dto.duplicadas ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Servicio de Certificados                                             */
/* ------------------------------------------------------------------ */

/** CU-P7-05: verificacion publica del pase. Siempre responde 200. */
export async function verificarCredencial(
  codigo: string,
  opciones: RequestOptions = {},
): Promise<CredentialVerification> {
  const parametros = new URLSearchParams({ codigo: codigo.trim() });
  const dto = await pedir<VerificacionDTO>(
    apiConfig.certificados,
    `/api/certificados/verificar?${parametros.toString()}`,
    opciones,
  );
  return aCredencial(exigir(dto, 'El Servicio de Certificados devolvio una respuesta vacia.'));
}

/* ------------------------------------------------------------------ */
/* Salud de la malla                                                   */
/* ------------------------------------------------------------------ */

export interface SaludMalla {
  estado: string;
  version: string;
  servicio: string;
}

/**
 * Prueba de vida de la malla desde el navegador: cada servicio expone su
 * ruta de salud, yeston un producto, dos servicios de catalogo/certificados.
 * Sirve para comprobar en una defensa que Vercel alcanza a la VM.
 */
export async function consultarSaludReservas(opciones: RequestOptions = {}): Promise<SaludMalla> {
  return pedir<SaludMalla>(apiConfig.reservas, '/api/salud', opciones);
}

export async function consultarSaludCatalogo(opciones: RequestOptions = {}): Promise<SaludMalla> {
  return pedir<SaludMalla>(apiConfig.catalogo, '/api/talleres/salud', opciones);
}

export async function consultarSaludCertificados(opciones: RequestOptions = {}): Promise<SaludMalla> {
  return pedir<SaludMalla>(apiConfig.certificados, '/api/certificados/salud', opciones);
}