/**
 * Modelo de dominio del Servicio de Catalogo de Talleres.
 *
 * Esta capa no importa express, grpc, pg ni ioredis. Describe el taller como
 * lo entiende el negocio y por eso puede probarse de forma aislada.
 */

export type EstadoEvento = 'PROGRAMADO' | 'EN_CURSO' | 'FINALIZADO' | 'CANCELADO';

export interface EventoResumen {
  eventoId: string;
  titulo: string;
  curso: string;
  ponente: string;
  fecha: string;
  modalidad: string;
  cuposDisponibles: number;
  cuposTotales: number;
  estado: EstadoEvento;
}

export interface EventoDetalle extends EventoResumen {
  correoPonente: string;
  descripcion: string;
  prerrequisitos: string[];
}

export interface ResultadoListado {
  eventos: EventoResumen[];
  total: number;
  origenCache: boolean;
}

export enum ResultadoCupo {
  ASIGNADO = 'CUPO_ASIGNADO',
  SIN_CUPO = 'SIN_CUPO',
  EVENTO_INEXISTENTE = 'EVENTO_INEXISTENTE',
  EVENTO_CERRADO = 'EVENTO_CERRADO',
  YA_OCUPADO = 'YA_OCUPADO',
}

export interface ClaimDeCupo {
  resultado: ResultadoCupo;
  cuposDisponibles: number;
  cuposTotales: number;
  titulo: string;
  mensaje: string;
}

/** Un evento admite reservas mientras no haya terminado ni sido cancelado. */
export function admiteReserva(estado: EstadoEvento): boolean {
  return estado === 'PROGRAMADO' || estado === 'EN_CURSO';
}

export function mensajeSegunResultado(resultado: ResultadoCupo): string {
  switch (resultado) {
    case ResultadoCupo.ASIGNADO:
      return 'Cupo asignado de forma atomica.';
    case ResultadoCupo.SIN_CUPO:
      return 'No fue posible confirmar la reserva porque el evento no tiene cupos.';
    case ResultadoCupo.EVENTO_CERRADO:
      return 'El evento no admite reservas porque ya no esta en curso.';
    case ResultadoCupo.YA_OCUPADO:
      return 'La reserva ya habia ocupado ese cupo.';
    default:
      return 'El evento solicitado no existe.';
  }
}
