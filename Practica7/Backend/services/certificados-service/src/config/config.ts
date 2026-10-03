/**
 * Configuracion de certificados por variables de entorno.
 *
 * CERTIFICADOS_CLAVE_FIRMA debe ser la misma que usa el worker
 * (WORKER_CLAVE_FIRMA): si difieren, ninguna firma verifica.
 */

import path from 'node:path';
import { z } from 'zod';

const esquema = z.object({
  CERTIFICADOS_VERSION: z.string().default('2.0.0'),
  CERTIFICADOS_HTTP_PUERTO: z.coerce.number().int().positive().default(8080),
  CERTIFICADOS_GRPC_PUERTO: z.coerce.number().int().positive().default(50063),
  CERTIFICADOS_PG_DSN: z.string().min(1, 'CERTIFICADOS_PG_DSN es obligatorio'),
  CERTIFICADOS_PG_MAX_CONEXIONES: z.coerce.number().int().positive().default(5),
  CERTIFICADOS_CLAVE_FIRMA: z.string().min(8, 'CERTIFICADOS_CLAVE_FIRMA es obligatorio'),
  CERTIFICADOS_ORIGENES_PERMITIDOS: z.string().default('*'),
  CERTIFICADOS_PROTO_DIR: z.string().optional(),
});

export type ConfiguracionCertificados = z.infer<typeof esquema>;

export function cargarConfiguracion(origen: NodeJS.ProcessEnv = process.env): ConfiguracionCertificados {
  const config = esquema.parse(origen);
  return {
    ...config,
    CERTIFICADOS_ORIGENES_PERMITIDOS: config.CERTIFICADOS_ORIGENES_PERMITIDOS.trim(),
    CERTIFICADOS_PROTO_DIR: config.CERTIFICADOS_PROTO_DIR ?? path.resolve(__dirname, '../../../proto'),
  };
}

export function origenesPermitidos(config: ConfiguracionCertificados): string[] {
  if (config.CERTIFICADOS_ORIGENES_PERMITIDOS === '*') return ['*'];
  return config.CERTIFICADOS_ORIGENES_PERMITIDOS.split(',').map((o) => o.trim()).filter(Boolean);
}
