/**
 * Configuracion de los endpoints del backend SOA.
 *
 * Practica 8: el frontend ya no usa datos mock. Habla por HTTP con los tres
 * servicios que corren en la Maquina Virtual de Desarrollo, y la unica forma
 * de cambiar de destino son estas variables de entorno.
 *
 * Next.js reemplaza `process.env.NEXT_PUBLIC_*` por su valor literal AL
 * compilar, y solo cuando el acceso es estatico. Por eso aqui no se hace
 * `process.env[clave]`: se escribe cada variable completa. Romper esa regla
 * hace que la variable llegue como `undefined` en el navegador sin avisar.
 *
 * Valores por defecto = la VM levantada con el docker-compose de desarrollo.
 * En Vercel se sobreescriben con la IP publica o el dominio de la VM.
 */

export interface ConfigEndpoints {
  /** Servicio de Catalogo de Talleres (TypeScript). Puerto 8081 en la VM. */
  catalogo: string;
  /** Servicio de Reservas / Ticketing, productor (Go). Puerto 8080 en la VM. */
  reservas: string;
  /** Servicio de Certificados (TypeScript). Puerto 8082 en la VM. */
  certificados: string;
  /** Milisegundos que se espera a la VM antes de cortar la peticion. */
  timeoutMs: number;
  /** Periodo del polling de seguimiento mientras el worker no responde. */
  pollingIntervalMs: number;
  /** Intentos de polling antes de pedirle al usuario que actualice a mano. */
  pollingMaxIntentos: number;
}

const BASE_POR_DEFECTO = 'http://localhost';

const TIMEOUT_POR_DEFECTO = 10000;
const POLLING_POR_DEFECTO = 2500;
const POLLING_MAX_INTENTOS_POR_DEFECTO = 24;

function sinBarraFinal(valor: string): string {
  return valor.replace(/\/+$/, '');
}

function entero(valor: string | undefined, porDefecto: number, minimo: number): number {
  const parsed = Number(valor);
  if (!Number.isFinite(parsed) || parsed <= 0) return porDefecto;
  return Math.max(parsed, minimo);
}

/**
 * Resuelve un endpoint. `NEXT_PUBLIC_API_BASE` funciona como destino comun
 * para los tres servicios: si la VM publica todo bajo un mismo dominio (por
 * ejemplo detras de un proxy inverso con reglas de ruta) alcanza con una sola
 * variable. Cada variable por servicio tiene prioridad sobre la comun.
 */
function resolver(porDefecto: string, especifico: string | undefined): string {
  const comun = process.env.NEXT_PUBLIC_API_BASE;
  const elegido = (especifico ?? comun ?? '').trim();
  if (!elegido) return `${BASE_POR_DEFECTO}:${porDefecto}`;
  return sinBarraFinal(elegido);
}

export const apiConfig: ConfigEndpoints = {
  catalogo: resolver('8081', process.env.NEXT_PUBLIC_API_CATALOGO_BASE),
  reservas: resolver('8080', process.env.NEXT_PUBLIC_API_RESERVAS_BASE),
  certificados: resolver('8082', process.env.NEXT_PUBLIC_API_CERTIFICADOS_BASE),
  timeoutMs: entero(process.env.NEXT_PUBLIC_API_TIMEOUT_MS, TIMEOUT_POR_DEFECTO, 1000),
  pollingIntervalMs: entero(
    process.env.NEXT_PUBLIC_API_POLLING_MS,
    POLLING_POR_DEFECTO,
    500,
  ),
  pollingMaxIntentos: entero(
    process.env.NEXT_PUBLIC_API_POLLING_MAX_INTENTOS,
    POLLING_MAX_INTENTOS_POR_DEFECTO,
    1,
  ),
};

/**
 * Host legible del backend, para mostrar en la interfaz de donde vienen los
 * datos. Es la forma mas rapida de comprobar en una defensa que Vercel esta
 * hablando con la VM y no con un mock.
 */
export function hostLegible(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}