/**
 * Borde gRPC del Servicio de Certificados.
 *
 * Dos publico distintos sobre el mismo caso de uso:
 *   - VerificarCredencial: el verificador publico (y tambien por HTTP);
 *   - RegistrarEmision:    solo reservation-worker, al emitir el pase.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';

import type { ServicioDeCertificados } from '../../application/services/servicio-de-certificados';
import { EstadoCredencial } from '../../domain/credencial';

interface VerificacionSolicitud {
  codigo: string;
  exigirFirma: boolean;
}

interface EmisionSolicitud {
  codigo: string;
  titulo: string;
  titular: string;
  eventoId: string;
  firma: string;
  emitidoEn: string;
  reservaId: string;
}

const ESTADO_A_ENUM: Record<EstadoCredencial, number> = {
  VALIDA: 1,
  INVALIDA: 2,
  NO_ENCONTRADA: 3,
};

export function crearServidorGrpc(
  servicio: ServicioDeCertificados,
  opciones: { protoPath: string; version: string; postgres: { ping(): Promise<void> } },
): grpc.Server {
  const definicion = protoLoader.loadSync(path.join(opciones.protoPath, 'certificados.proto'), {
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });

  const descriptor = grpc.loadPackageDefinition(definicion) as unknown as {
    academix: { credenciales: { v1: { CertificadosService: grpc.ServiceClientConstructor & { service: grpc.ServiceDefinition } } } };
  };

  const server = new grpc.Server();

  const unary =
    <Solicitud, Respuesta>(
      manejar: (solicitud: Solicitud) => Promise<Respuesta | null>,
    ): grpc.handleUnaryCall<unknown, unknown> =>
    (call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>): void => {
      manejar(call.request as Solicitud)
        .then((respuesta) => callback(null, respuesta ?? {}))
        .catch((error: unknown) => {
          callback({
            code: grpc.status.INTERNAL,
            message: error instanceof Error ? error.message : 'Error interno de credenciales.',
          }, null);
        });
    };

  const handlers: grpc.UntypedServiceImplementation = {
    Health: unary<unknown, unknown>(async () => {
      let postgres = 'no disponible';
      try {
        await opciones.postgres.ping();
        postgres = 'operativo';
      } catch {
        postgres = 'no disponible';
      }
      return { estado: postgres === 'operativo' ? 'ok' : 'degradado', version: opciones.version, dependenciaPostgres: postgres };
    }),

    VerificarCredencial: unary<VerificacionSolicitud, unknown>(async (llamada) => {
      const verificacion = await servicio.verificar(llamada.codigo, Boolean(llamada.exigirFirma));
      return {
        codigo: verificacion.codigo,
        estado: ESTADO_A_ENUM[verificacion.estado],
        titulo: verificacion.titulo,
        titular: verificacion.titular,
        emitidoEn: verificacion.emitidoEn,
        mensaje: verificacion.mensaje,
      };
    }),

    RegistrarEmision: unary<EmisionSolicitud, unknown>(async (llamada) => {
      const resultado = await servicio.registrarEmision({
        codigo: llamada.codigo,
        titulo: llamada.titulo,
        titular: llamada.titular,
        eventoId: llamada.eventoId,
        firma: llamada.firma,
        emitidoEn: llamada.emitidoEn,
        reservaId: llamada.reservaId,
      });
      return { registrada: resultado.registrada, yaExistia: resultado.yaExistia };
    }),
  };

  server.addService(descriptor.academix.credenciales.v1.CertificadosService.service, handlers);

  return server;
}
