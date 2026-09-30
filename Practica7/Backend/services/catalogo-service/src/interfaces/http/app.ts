/**
 * Borde HTTP del Servicio de Catalogo.
 *
 * Es lo unico que consume el navegador desplegado en Vercel. No contiene
 * reglas de negocio: traduce HTTP a los casos de uso y traduce errores de
 * dominio a codigos de estado.
 */

import express, { type Express, type Request, type Response } from 'express';

import { CatalogoDeTalleres } from '../../application/services/catalogo-de-talleres';
import type { CacheCatalogo } from '../../application/ports/catalogo';
import { ResultadoCupo } from '../../domain/evento';

const ESTADO_A_NUMERO: Record<string, number> = {
  ESTADO_EVENTO_NO_ESPECIFICADO: 0,
  PROGRAMADO: 1,
  EN_CURSO: 2,
  FINALIZADO: 3,
  CANCELADO: 4,
};

const RESULTADO_A_NUMERO: Record<string, number> = {
  RESULTADO_CUPO_NO_ESPECIFICADO: 0,
  CUPO_ASIGNADO: 1,
  SIN_CUPO: 2,
  EVENTO_INEXISTENTE: 3,
  EVENTO_CERRADO: 4,
  YA_OCUPADO: 5,
};

function cors(origenes: string[]) {
  const permitidos = new Set(origenes);
  // `*` habilita cualquier origen. Sin esta comprobacion el comodin se
  // comparaba literalmente contra el Origin de la peticion, que nunca es la
  // cadena "*", y el navegador descartaba la respuesta sin avisar.
  const cualquiera = permitidos.has('*');
  return (req: Request, res: Response, next: () => void): void => {
    const origen = req.headers.origin;
    if (cualquiera) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origen && permitidos.has(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function crearAplicacionHttp(
  servicio: CatalogoDeTalleres,
  dependencias: {
    version: string;
    origenesPermitidos: string[];
    postgres: { ping(): Promise<void> };
    cache: CacheCatalogo;
  },
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(cors(dependencias.origenesPermitidos));

  app.get('/api/talleres/salud', async (_req, res) => {
    let postgres = 'no disponible';
    try {
      await dependencias.postgres.ping();
      postgres = 'operativo';
    } catch {
      postgres = 'no disponible';
    }
    const redis = (await dependencias.cache.ping()) ? 'operativo' : 'no disponible';
    const degradado = postgres !== 'operativo';
    res.status(degradado ? 503 : 200).json({
      estado: degradado ? 'degradado' : 'ok',
      version: dependencias.version,
      servicio: 'catalogo-service',
      detalle: { postgres, redis, cacheOperativo: redis === 'operativo' },
    });
  });

  // CU-P7-01: consultar catalogo de eventos.
  app.get('/api/talleres/eventos', async (req, res) => {
    const resultado = await servicio.listarEventos({
      busqueda: String(req.query.busqueda ?? ''),
      limite: Number(req.query.limite ?? 20),
      offset: Number(req.query.offset ?? 0),
      soloConCupo: req.query.soloConCupo === 'true',
    });
    res.json({
      eventos: resultado.eventos.map((evento) => ({
        ...evento,
        estado: ESTADO_A_NUMERO[evento.estado] ?? 0,
      })),
      total: resultado.total,
      origenCache: resultado.origenCache,
    });
  });

  // CU-P7-02: detalle y disponibilidad.
  app.get('/api/talleres/eventos/:eventoId', async (req, res) => {
    const { evento, origenCache } = await servicio.obtenerEvento(req.params.eventoId);
    if (!evento) {
      res.status(404).json({
        codigo: 'EVENTO_NO_ENCONTRADO',
        mensaje: 'No se encontro el evento solicitado.',
      });
      return;
    }
    res.json({
      evento: { ...evento, estado: ESTADO_A_NUMERO[evento.estado] ?? 0 },
      origenCache,
    });
  });

  app.get('/api/talleres/eventos/:eventoId/disponibilidad', async (req, res) => {
    const disponibilidad = await servicio.consultarDisponibilidad(req.params.eventoId);
    res.json({ eventoId: req.params.eventoId, ...disponibilidad });
  });

  app.get('/api/talleres/resumen', async (_req, res) => {
    res.json(await servicio.resumen());
  });

  // El worker reclama cupos por gRPC (ver src/interfaces/grpc/server.ts).
  // Esta ruta existe para poder inspeccionar el comportamiento atomico con
  // curl durante la evaluacion, sin montar un cliente gRPC.
  app.post('/api/talleres/cupos', async (req, res) => {
    const { eventoId, reservaId, trackingId } = req.body ?? {};
    if (typeof eventoId !== 'string' || typeof reservaId !== 'string') {
      res.status(400).json({ codigo: 'SOLICITUD_INVALIDA', mensaje: 'eventoId y reservaId son obligatorios.' });
      return;
    }
    const claim = await servicio.reclamarCupo(eventoId, reservaId, String(trackingId ?? ''));
    res.status(claim.resultado === ResultadoCupo.ASIGNADO ? 200 : 409).json({
      resultado: RESULTADO_A_NUMERO[claim.resultado] ?? 0,
      resultadoTexto: claim.resultado,
      cuposDisponibles: claim.cuposDisponibles,
      cuposTotales: claim.cuposTotales,
      titulo: claim.titulo,
      mensaje: claim.mensaje,
    });
  });

  return app;
}
