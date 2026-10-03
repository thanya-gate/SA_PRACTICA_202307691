/**
 * Punto de entrada del Servicio de Certificados.
 *
 * HTTP 8080 para el verificador publico y gRPC 50052 para el worker.
 * Comparte la clave de firma con el worker: es el unico secreto que enlaza
 * ambos servicios.
 */

import http from 'node:http';
import path from 'node:path';
import { ServerCredentials } from '@grpc/grpc-js';

import { ServicioDeCertificados } from './application/services/servicio-de-certificados';
import { cargarConfiguracion, origenesPermitidos } from './config/config';
import { PostgresCredenciales } from './infrastructure/persistence/postgres/credenciales-postgres';
import { crearAplicacionHttp } from './interfaces/http/app';
import { crearServidorGrpc } from './interfaces/grpc/server';

async function main(): Promise<void> {
  const config = cargarConfiguracion();

  const postgres = new PostgresCredenciales(config.CERTIFICADOS_PG_DSN, config.CERTIFICADOS_PG_MAX_CONEXIONES);
  const servicio = new ServicioDeCertificados(postgres, config.CERTIFICADOS_CLAVE_FIRMA);

  const app = crearAplicacionHttp(servicio, {
    version: config.CERTIFICADOS_VERSION,
    origenesPermitidos: origenesPermitidos(config),
    postgres,
  });
  const servidorHttp = http.createServer(app);

  await new Promise<void>((resolve) => servidorHttp.listen(config.CERTIFICADOS_HTTP_PUERTO, '0.0.0.0', resolve));
  console.log(`[certificados] HTTP escuchando en 0.0.0.0:${config.CERTIFICADOS_HTTP_PUERTO}`);
  const servidorGrpc = crearServidorGrpc(servicio, {
    protoPath: config.CERTIFICADOS_PROTO_DIR ?? path.resolve(__dirname, '../../../proto'),
    version: config.CERTIFICADOS_VERSION,
    postgres,
  });

  await new Promise<void>((resolve, reject) => {
    servidorGrpc.bindAsync(
      `0.0.0.0:${config.CERTIFICADOS_GRPC_PUERTO}`,
      ServerCredentials.createInsecure(),
      (error) => (error ? reject(error) : resolve()),
    );
  });
  console.log(`[certificados] gRPC escuchando en 0.0.0.0:${config.CERTIFICADOS_GRPC_PUERTO}`);

  let apagando = false;
  const apagar = async (senal: string): Promise<void> => {
    if (apagando) return;
    apagando = true;
    console.log(`[certificados] ${senal} recibido, cerrando...`);

    await new Promise<void>((resolve) => servidorHttp.close(() => resolve()));
    await new Promise<void>((resolve) => servidorGrpc.tryShutdown(() => resolve()));
    await postgres.cerrar();
    console.log('[certificados] apagado limpio.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

main().catch((error) => {
  console.error('[certificados] fallo al arrancar:', error);
  process.exit(1);
});
