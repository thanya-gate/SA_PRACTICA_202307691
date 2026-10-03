/**
 * Configuracion del catalogo por variables de entorno.
 *
 * Se valida con Zod al arrancar: si falta el DSN el proceso muere de una
 * vez, en lugar de fallar en la primera reserva de la madrugada.
 */

import path from 'node:path';
import { z } from 'zod';

const esquema = z.object({
  CATALOGO_VERSION: z.string().default('2.0.0'),
  CATALOGO_NODE_ENV: z.enum(['produccion', 'desarrollo']).default('produccion'),
  CATALOGO_HTTP_PUERTO: z.coerce.number().int().positive().default(8080),
  CATALOGO_GRPC_PUERTO: z.coerce.number().int().positive().default(50061),
  CATALOGO_PG_DSN: z.string().min(1, 'CATALOGO_PG_DSN es obligatorio'),
  CATALOGO_PG_MAX_CONEXIONES: z.coerce.number().int().positive().default(10),
  CATALOGO_REDIS_URL: z.string().min(1, 'CATALOGO_REDIS_URL es obligatorio'),
  CATALOGO_TTL_LISTADO_SEG: z.coerce.number().int().positive().default(15),
  CATALOGO_TTL_DETALLE_SEG: z.coerce.number().int().positive().default(30),
  CATALOGO_ORIGENES_PERMITIDOS: z.string().default('*'),
  CATALOGO_PROTO_DIR: z.string().optional(),
});

export type ConfiguracionCatalogo = z.infer<typeof esquema>;

export function cargarConfiguracion(origen: NodeJS.ProcessEnv = process.env): ConfiguracionCatalogo {
  const config = esquema.parse(origen);
  return {
    ...config,
    CATALOGO_ORIGENES_PERMITIDOS: config.CATALOGO_ORIGENES_PERMITIDOS.trim(),
    CATALOGO_PROTO_DIR: config.CATALOGO_PROTO_DIR ?? path.resolve(__dirname, '../../../proto'),
  };
}

export function origenesPermitidos(config: ConfiguracionCatalogo): string[] {
  if (config.CATALOGO_ORIGENES_PERMITIDOS === '*') return ['*'];
  return config.CATALOGO_ORIGENES_PERMITIDOS.split(',').map((o) => o.trim()).filter(Boolean);
}
