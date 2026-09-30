/**
 * Punto de entrada del Servicio de Catalogo de Talleres.
 *
 * Levanta dos bordes sobre el mismo caso de uso:
 *   - HTTP  8080  para el navegador (Vercel)
 *   - gRPC  50051 para el worker Python
 *
 * Ambos comparten la misma instancia de CatalogoDeTalleres, de modo que la
 * cache y la logica de cupos no se duplican.
 */

import http from 'node:http';
import path from 'node:path';
import { ServerCredentials } from '@grpc/grpc-js';

import { CatalogoDeTalleres } from './application/services/catalogo-de-talleres';
import { cargarConfiguracion, origenesPermitidos } from './config/config';
import { RedisCatalogo } from './infrastructure/cache/redis-catalogo';
import { PostgresCatalogo } from './infrastructure/persistence/postgres/catalogo-postgres';
import { crearAplicacionHttp } from './interfaces/http/app';
import { crearServidorGrpc } from './interfaces/grpc/server';

async function main(): Promise<void> {
  const config = cargarConfiguracion();

  const postgres = new PostgresCatalogo(config.CATALOGO_PG_DSN, config.CATALOGO_PG_MAX_CONEXIONES);
  const cache = new RedisCatalogo(config.CATALOGO_REDIS_URL);

  // La cache es un acelerador, no una dependencia critica: si Redis no
  // responde, el catalogo sigue funcionando contra PostgreSQL.
  if (!(await cache.ping())) {
    console.warn('[catalogo] Redis no responde al arrancar; se opera sin cache.');
  }

  const servicio = new CatalogoDeTalleres(
    postgres,
    cache,
    config.CATALOGO_TTL_LISTADO_SEG,
    config.CATALOGO_TTL_DETALLE_SEG,
  );

  const app = crearAplicacionHttp(servicio, {
    version: config.CATALOGO_VERSION,
    origenesPermitidos: origenesPermitidos(config),
    postgres,
    cache,
  });
  const servidorHttp = http.createServer(app);

  await new Promise<void>((resolve) => servidorHttp.listen(config.CATALOGO_HTTP_PUERTO, '0.0.0.0', resolve));
  console.log(`[catalogo] HTTP escuchando en 0.0.0.0:${config.CATALOGO_HTTP_PUERTO}`);

  const servidorGrpc = crearServidorGrpc(servicio, {
    protoPath: config.CATALOGO_PROTO_DIR ?? path.resolve(__dirname, '../../../proto'),
    version: config.CATALOGO_VERSION,
    postgres,
    cache,
  });

  await new Promise<void>((resolve, reject) => {
    servidorGrpc.bindAsync(
      `0.0.0.0:${config.CATALOGO_GRPC_PUERTO}`,
      ServerCredentials.createInsecure(),
      (error) => (error ? reject(error) : resolve()),
    );
  });
  console.log(`[catalogo] gRPC escuchando en 0.0.0.0:${config.CATALOGO_GRPC_PUERTO}`);

  let apagando = false;
  const apagar = async (senal: string): Promise<void> => {
    if (apagando) return;
    apagando = true;
    console.log(`[catalogo] ${senal} recibido, cerrando...`);

    await new Promise<void>((resolve) => servidorHttp.close(() => resolve()));
    await new Promise<void>((resolve) => servidorGrpc.tryShutdown(() => resolve()));
    await cache.cerrar();
    await postgres.cerrar();
    console.log('[catalogo] apagado limpio.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

main().catch((error) => {
  console.error('[catalogo] fallo al arrancar:', error);
  process.exit(1);
});
