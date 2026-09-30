/**
 * Puertos del Servicio de Certificados.
 *
 * credenciales-db es propiedad exclusiva de este servicio: el worker nunca
 * escribe en ella, solo pide el registro por gRPC.
 */

import type { Credencial, EmisionPendiente } from '../../domain/credencial';

export interface CredencialesRepositorio {
  buscar(codigo: string): Promise<Credencial | null>;
  registrar(emision: EmisionPendiente): Promise<{ registrada: boolean; yaExistia: boolean }>;
  registrarVerificacion(codigo: string, resultado: string): Promise<void>;
  contar(): Promise<number>;
  ping(): Promise<void>;
}
