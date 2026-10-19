/**
 * Casos de uso del Servicio de Certificados.
 *
 * CU-P7-04: verificar el codigo de validacion impreso en el pase.
 * CU-P8-05: registrar la emision que el worker acaba de hacer.
 */

import type { CredencialesRepositorio } from '../ports/credenciales';
import {
  type EmisionPendiente,
  type Verificacion,
  EstadoCredencial,
  codigoTieneFormatoValido,
  evaluarCredencial,
} from '../../domain/credencial';

export class ServicioDeCertificados {
  constructor(
    private readonly repositorio: CredencialesRepositorio,
    private readonly claveSecreta: string,
  ) {}

  /**
   * Verifica un codigo. Cada intento queda en verificacion_auditoria, tanto si
   * el codigo existe como si no: asi se puede detectar un uso de fuerza
   * bruta contra el verificador.
   */
  async verificar(codigo: string, exigirFirma: boolean): Promise<Verificacion> {
    const normalizado = codigo.trim().toUpperCase();

    if (!normalizado) {
      return {
        codigo: normalizado,
        estado: EstadoCredencial.NO_ENCONTRADA,
        titulo: '',
        titular: '',
        emitidoEn: '',
        mensaje: 'Debe indicar el codigo de validacion del pase.',
      };
    }

    // Se consulta igual aunque el formato sea raro: registrar el intento es
    // justamente lo que detecta un abuso del endpoint publico.
    const credencial = await this.repositorio.buscar(normalizado);
    const verificacion =
      codigoTieneFormatoValido(normalizado) || credencial
        ? evaluarCredencial(credencial, normalizado, exigirFirma, this.claveSecreta)
        : evaluarCredencial(null, normalizado, exigirFirma, this.claveSecreta);

    await this.repositorio.registrarVerificacion(normalizado, verificacion.estado);

    return verificacion;
  }

  /**
   * Billetera del estudiante (YoUSAC): sus credenciales con el estado de
   * verificacion ya evaluado. No suma a la auditoria: no es un intento de
   * verificar un codigo ajeno, sino consultar las propias.
   */
  async listarPorTitular(titular: string): Promise<Verificacion[]> {
    if (!titular.trim()) return [];
    const credenciales = await this.repositorio.listarPorTitular(titular);
    return credenciales.map((c) => evaluarCredencial(c, c.codigo, true, this.claveSecreta));
  }

  /** Registra la emision que el worker realizo al confirmar la reserva. */
  async registrarEmision(emision: EmisionPendiente): Promise<{ registrada: boolean; yaExistia: boolean }> {
    if (!emision.codigo.trim() || !emision.titular.trim()) {
      return { registrada: false, yaExistia: false };
    }
    return this.repositorio.registrar({ ...emision, codigo: emision.codigo.trim().toUpperCase() });
  }

  async resumen() {
    return { credenciales: await this.repositorio.contar() };
  }
}
