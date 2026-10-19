/**
 * Doble en memoria de credenciales.
 *
 * Reproduce el ON CONFLICT DO NOTHING de fn_registrar_credencial para poder
 * probar la idempotencia del registro sin PostgreSQL.
 */

import type { CredencialesRepositorio } from '../../../application/ports/credenciales';
import type { Credencial, EmisionPendiente } from '../../../domain/credencial';

export class CredencialesEnMemoria implements CredencialesRepositorio {
  readonly credenciales = new Map<string, Credencial>();
  readonly auditoria: { codigo: string; resultado: string }[] = [];

  sembrar(credenciales: Partial<Credencial>[]): void {
    for (const parcial of credenciales) {
      const credencial: Credencial = {
        codigo: 'CERT-2026-000000',
        titulo: 'Asistencia a taller',
        titular: 'Estudiante Demo',
        eventoId: 'EVT-1',
        firma: '',
        emitidoEn: '2026-10-05T15:00:00.000Z',
        revocada: false,
        verificaciones: 0,
        ...parcial,
      };
      this.credenciales.set(credencial.codigo, credencial);
    }
  }

  async buscar(codigo: string): Promise<Credencial | null> {
    return this.credenciales.get(codigo) ?? null;
  }

  async listarPorTitular(titular: string): Promise<Credencial[]> {
    const buscado = titular.trim().toLowerCase();
    return [...this.credenciales.values()]
      .filter((c) => c.titular.trim().toLowerCase() === buscado)
      .sort((a, b) => b.emitidoEn.localeCompare(a.emitidoEn));
  }

  async registrar(emision: EmisionPendiente): Promise<{ registrada: boolean; yaExistia: boolean }> {
    const yaExistia = this.credenciales.has(emision.codigo);
    if (!yaExistia) {
      this.credenciales.set(emision.codigo, {
        codigo: emision.codigo,
        titulo: emision.titulo,
        titular: emision.titular,
        eventoId: emision.eventoId,
        firma: emision.firma,
        emitidoEn: emision.emitidoEn,
        revocada: false,
        verificaciones: 0,
      });
    }
    return { registrada: true, yaExistia };
  }

  async registrarVerificacion(codigo: string, resultado: string): Promise<void> {
    this.auditoria.push({ codigo, resultado });
    const credencial = this.credenciales.get(codigo);
    if (credencial) credencial.verificaciones += 1;
  }

  async contar(): Promise<number> {
    return this.credenciales.size;
  }

  async ping(): Promise<void> {
    /* sin dependencias externas */
  }
}
