/**
 * Borde gRPC del Servicio de Catalogo.
 *
 * Aqui llega el worker, no el navegador. ReclamarCupo es el metodo mas
 * importante del sistema: es la unica via por la que un cupo se descuenta y
 * por eso queda detras de gRPC, fuera del alcance del navegador.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';

import type { CatalogoDeTalleres } from '../../application/services/catalogo-de-talleres';
import type { CacheCatalogo } from '../../application/ports/catalogo';
import { ResultadoCupo, type EstadoEvento } from '../../domain/evento';

interface EventoIdSolicitud {
  eventoId: string;
}

interface ReservaSolicitud {
  eventoId: string;
  reservaId: string;
}

interface ListarEventosSolicitud {
  busqueda: string;
  limite: number;
  offset: number;
  soloConCupo: boolean;
}

interface CupoSolicitud {
  eventoId: string;
  reservaId: string;
  trackingId: string;
}

interface ValidarEventoRespuesta {
  existe: boolean;
  admite: boolean;
  titulo: string;
  estado: EstadoEvento | '';
  motivo: string;
}

const ESTADO_A_ENUM: Record<string, number> = {
  ESTADO_EVENTO_NO_ESPECIFICADO: 0,
  PROGRAMADO: 1,
  EN_CURSO: 2,
  FINALIZADO: 3,
  CANCELADO: 4,
};

const NUMERO_A_ESTADO: Record<number, EstadoEvento> = {
  0: 'PROGRAMADO',
  1: 'PROGRAMADO',
  2: 'EN_CURSO',
  3: 'FINALIZADO',
  4: 'CANCELADO',
};

const RESULTADO_A_ENUM: Record<string, number> = {
  RESULTADO_CUPO_NO_ESPECIFICADO: 0,
  CUPO_ASIGNADO: 1,
  SIN_CUPO: 2,
  EVENTO_INEXISTENTE: 3,
  EVENTO_CERRADO: 4,
  YA_OCUPADO: 5,
};

export function crearServidorGrpc(
  servicio: CatalogoDeTalleres,
  opciones: { protoPath: string; version: string; postgres: { ping(): Promise<void> }; cache: CacheCatalogo },
): grpc.Server {
  const definicion = protoLoader.loadSync(path.join(opciones.protoPath, 'catalogo.proto'), {
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });

  const descriptor = grpc.loadPackageDefinition(definicion) as unknown as {
    academix: { catalogo: { v1: { CatalogoService: grpc.ServiceClientConstructor & { service: grpc.ServiceDefinition } } } };
  };

  const server = new grpc.Server();

  /**
   * Adapta un manejador tipado a la firma que espera @grpc/grpc-js.
   * grpc-js entrega la peticion en `call.request`; con esto queda tipada
   * dentro del manejador y no hace falta repetir casts en cada metodo.
   */
  const unary =
    <Solicitud, Respuesta>(
      manejar: (solicitud: Solicitud) => Promise<Respuesta | null>,
    ): grpc.handleUnaryCall<unknown, unknown> =>
    (call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>): void => {
      manejar(call.request as Solicitud)
        .then((respuesta) => callback(null, respuesta ?? {}))
        .catch((error: unknown) => {
          if (error && typeof error === 'object' && 'code' in error) {
            callback(error as grpc.ServiceError, null);
            return;
          }
          callback({
            code: grpc.status.INTERNAL,
            message: error instanceof Error ? error.message : 'Error interno del catalogo.',
          }, null);
        });
    };

  const handlers: grpc.UntypedServiceImplementation = {
    Health: unary(async () => {
      let postgres = 'no disponible';
      try {
        await opciones.postgres.ping();
        postgres = 'operativo';
      } catch {
        postgres = 'no disponible';
      }
      const redis = (await opciones.cache.ping()) ? 'operativo' : 'no disponible';
      return {
        estado: postgres === 'operativo' ? 'ok' : 'degradado',
        version: opciones.version,
        dependenciaPostgres: postgres,
        dependenciaRedis: redis,
        cacheOperativo: redis === 'operativo',
      };
    }),

    ListarEventos: unary<ListarEventosSolicitud, unknown>(async (llamada) => {
      const resultado = await servicio.listarEventos(llamada);
      return {
        eventos: resultado.eventos.map((evento) => ({
          eventoId: evento.eventoId,
          titulo: evento.titulo,
          curso: evento.curso,
          ponente: evento.ponente,
          fecha: evento.fecha,
          modalidad: evento.modalidad,
          cuposDisponibles: evento.cuposDisponibles,
          cuposTotales: evento.cuposTotales,
          estado: ESTADO_A_ENUM[evento.estado] ?? 0,
        })),
        total: resultado.total,
        origenCache: resultado.origenCache,
      };
    }),

    ObtenerEvento: unary<EventoIdSolicitud, unknown>(async (llamada) => {
      const { evento, origenCache } = await servicio.obtenerEvento(llamada.eventoId);
      if (!evento) {
        throw { code: grpc.status.NOT_FOUND, message: 'El evento no existe.' };
      }
      return {
        evento: {
          eventoId: evento.eventoId,
          titulo: evento.titulo,
          curso: evento.curso,
          ponente: evento.ponente,
          correoPonente: evento.correoPonente,
          fecha: evento.fecha,
          modalidad: evento.modalidad,
          descripcion: evento.descripcion,
          prerrequisitos: evento.prerrequisitos,
          cuposDisponibles: evento.cuposDisponibles,
          cuposTotales: evento.cuposTotales,
          estado: ESTADO_A_ENUM[evento.estado] ?? 0,
        },
        origenCache,
      };
    }),

    ValidarEvento: unary<EventoIdSolicitud, unknown>(async (llamada) => {
      const validacion: ValidarEventoRespuesta = await servicio.validarEvento(llamada.eventoId);
      return {
        existe: validacion.existe,
        admiteReserva: validacion.admite,
        titulo: validacion.titulo,
        estado: ESTADO_A_ENUM[validacion.estado] ?? 0,
        motivo: validacion.motivo,
      };
    }),

    ConsultarDisponibilidad: unary<EventoIdSolicitud, unknown>(async (llamada) => {
      const disponibilidad = await servicio.consultarDisponibilidad(llamada.eventoId);
      return {
        eventoId: llamada.eventoId,
        cuposDisponibles: disponibilidad.disponibles,
        cuposTotales: disponibilidad.totales,
        admiteReserva: disponibilidad.admite,
      };
    }),

    InvalidarCache: unary<EventoIdSolicitud, unknown>(async (llamada) => ({
      invalidado: await servicio.invalidarCache(llamada.eventoId),
    })),

    ReclamarCupo: unary<CupoSolicitud, unknown>(async (llamada) => {
      const claim = await servicio.reclamarCupo(llamada.eventoId, llamada.reservaId, llamada.trackingId);
      return {
        resultado: RESULTADO_A_ENUM[claim.resultado] ?? 0,
        cuposDisponibles: claim.cuposDisponibles,
        cuposTotales: claim.cuposTotales,
        titulo: claim.titulo,
        mensaje: claim.mensaje,
      };
    }),

    LiberarCupo: unary<ReservaSolicitud, unknown>(async (llamada) => {
      const liberado = await servicio.liberarCupo(llamada.eventoId, llamada.reservaId);
      return { liberado: liberado.liberado, cuposDisponibles: liberado.cuposDisponibles };
    }),
  };

  server.addService(descriptor.academix.catalogo.v1.CatalogoService.service, handlers);

  return server;
}

export { NUMERO_A_ESTADO, RESULTADO_A_ENUM, ResultadoCupo };
