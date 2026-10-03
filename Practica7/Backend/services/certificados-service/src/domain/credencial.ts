/**
 * Dominio del Servicio de Certificados.
 *
 * La firma del pase se calcula exactamente igual que en el worker Python
 * (HMAC-SHA256 sobre "codigo|evento_id", recortado a 32 caracteres). Si una de
 * las dos implementaciones cambiara, la verificacion fallaria en silencio,
 * asi que el algoritmo esta documentado aqui y en el worker.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export enum EstadoCredencial {
  VALIDA = 'VALIDA',
  INVALIDA = 'INVALIDA',
  NO_ENCONTRADA = 'NO_ENCONTRADA',
}

export interface Credencial {
  codigo: string;
  titulo: string;
  titular: string;
  eventoId: string;
  firma: string;
  emitidoEn: string;
  revocada: boolean;
  verificaciones: number;
}

export interface Verificacion {
  codigo: string;
  estado: EstadoCredencial;
  titulo: string;
  titular: string;
  emitidoEn: string;
  mensaje: string;
}

export interface EmisionPendiente {
  codigo: string;
  titulo: string;
  titular: string;
  eventoId: string;
  firma: string;
  emitidoEn: string;
  reservaId: string;
}

/** Recorta la firma a 32 caracteres, igual que el worker. */
export function firmarPase(codigoValidacion: string, eventoId: string, claveSecreta: string): string {
  const mensaje = Buffer.from(`${codigoValidacion}|${eventoId}`, 'utf-8');
  return createHmac('sha256', claveSecreta).update(mensaje).digest('hex').slice(0, 32);
}

/**
 * Comparacion en tiempo constante. Un attacker que pueda medir cuanto tarda
 * la comparacion acaba adivinando la firma caracter por caracter, asi que
 * timingSafeEqual es obligatorio aqui.
 */
export function verificarFirma(
  codigoValidacion: string,
  eventoId: string,
  claveSecreta: string,
  firma: string,
): boolean {
  const esperada = firmarPase(codigoValidacion, eventoId, claveSecreta);
  const a = Buffer.from(esperada, 'utf-8');
  const b = Buffer.from(firma ?? '', 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const FORMATO_CODIGO = /^CERT-\d{4}-\d{6}$/;

export function codigoTieneFormatoValido(codigo: string): boolean {
  return FORMATO_CODIGO.test(codigo.trim().toUpperCase());
}

export function mensajePorEstado(estado: EstadoCredencial): string {
  switch (estado) {
    case EstadoCredencial.VALIDA:
      return 'Credencial valida: el pase fue emitido por el sistema y no ha sido alterado.';
    case EstadoCredencial.INVALIDA:
      return 'La credencial fue revocada o su firma no coincide.';
    default:
      return 'No se encontro ninguna credencial emitida con ese codigo.';
  }
}

/**
 * Regla de negocio de la verificacion, aislada de gRPC y de PostgreSQL.
 * Exigir la firma es opcional porque la credencial semilla de demostracion
 * se creo con una firma de relleno.
 */
export function evaluarCredencial(
  credencial: Credencial | null,
  codigo: string,
  exigirFirma: boolean,
  claveSecreta: string,
): Verificacion {
  if (!credencial) {
    return {
      codigo,
      estado: EstadoCredencial.NO_ENCONTRADA,
      titulo: '',
      titular: '',
      emitidoEn: '',
      mensaje: mensajePorEstado(EstadoCredencial.NO_ENCONTRADA),
    };
  }

  const firmaValida = verificarFirma(credencial.codigo, credencial.eventoId, claveSecreta, credencial.firma);
  const invalida = credencial.revocada || (exigirFirma && !firmaValida);
  const estado = invalida ? EstadoCredencial.INVALIDA : EstadoCredencial.VALIDA;

  return {
    codigo: credencial.codigo,
    estado,
    titulo: credencial.titulo,
    titular: credencial.titular,
    emitidoEn: credencial.emitidoEn,
    mensaje: mensajePorEstado(estado),
  };
}
