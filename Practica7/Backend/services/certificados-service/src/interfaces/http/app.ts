/**
 * Borde HTTP del Servicio de Certificados.
 *
 * Este es el endpoint publico: cualquiera con el codigo impreso en el pase
 * puede verificarlo. Por eso se responde siempre 200 con un estado legible
 * (VALIDA / INVALIDA / NO_ENCONTRADA) en vez de 404: el codigo se considera
 * un dato que el usuario posee, no un recurso privado.
 */

import express, { type Express, type Request, type Response } from 'express';

import { ServicioDeCertificados } from '../../application/services/servicio-de-certificados';
import { EstadoCredencial } from '../../domain/credencial';

const ESTADO_A_NUMERO: Record<EstadoCredencial, number> = {
  [EstadoCredencial.VALIDA]: 1,
  [EstadoCredencial.INVALIDA]: 2,
  [EstadoCredencial.NO_ENCONTRADA]: 3,
};

function cors(origenes: string[]) {
  const permitidos = new Set(origenes);
  return (req: Request, res: Response, next: () => void): void => {
    const origen = req.headers.origin;
    if (origen && permitidos.has(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function crearAplicacionHttp(
  servicio: ServicioDeCertificados,
  dependencias: { version: string; origenesPermitidos: string[]; postgres: { ping(): Promise<void> } },
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(cors(dependencias.origenesPermitidos));

  app.get('/api/certificados/salud', async (_req, res) => {
    let postgres = 'no disponible';
    try {
      await dependencias.postgres.ping();
      postgres = 'operativo';
    } catch {
      postgres = 'no disponible';
    }
    const degradado = postgres !== 'operativo';
    res.status(degradado ? 503 : 200).json({
      estado: degradado ? 'degradado' : 'ok',
      version: dependencias.version,
      servicio: 'certificados-service',
      detalle: { postgres },
    });
  });

  // CU-P7-04: verificar credencial.
  app.get('/api/certificados/verificar', async (req, res) => {
    const codigo = String(req.query.codigo ?? '');
    const exigirFirma = String(req.query.exigirFirma ?? 'false') === 'true';
    const verificacion = await servicio.verificar(codigo, exigirFirma);

    res.json({
      ...verificacion,
      estado: ESTADO_A_NUMERO[verificacion.estado],
      estadoTexto: verificacion.estado,
    });
  });

  app.get('/api/certificados/resumen', async (_req, res) => {
    res.json(await servicio.resumen());
  });

  return app;
}
