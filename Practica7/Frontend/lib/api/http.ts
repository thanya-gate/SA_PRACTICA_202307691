/**
 * Cliente HTTP minimo contra los servicios de la VM.
 *
 * Es la unica pieza del frontend que conoce fetch, los codigos de estado y la
 * forma del cuerpo de error. Ningun componente ve un `Response`: todos reciben
 * datos ya traducidos o una `ApiError`, lo que permite probar los componentes
 * sin levantar la malla SOA.
 */

import { apiConfig } from '@/lib/config';

/** Codigos que el frontend ya tenia definidos en la Practica 7. */
export type ApiErrorCode = 'NOT_FOUND' | 'NETWORK' | 'VALIDATION' | 'INVALID_RESPONSE' | 'TIMEOUT';

const MENSAJE_SIN_CONEXION =
  'No se pudo contactar al backend. Verifica que la Maquina Virtual este encendida y que el navegador permita el dominio.';
const MENSAJE_TIMEOUT =
  'La Maquina Virtual no respondio a tiempo. Intenta de nuevo en unos segundos.';

/**
 * Error normalizado del backend. Conserva el status y el codigo del servicio
 * para que la interfaz pueda decidir sin interpretar cadenas de texto.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status = 500,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Cuerpo de error uniforme que devuelven los tres servicios. */
interface ErrorDTO {
  codigo?: string;
  mensaje?: string;
  requestId?: string;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

/**
 * Traduce el codigo del servicio a uno de los que la interfaz ya conoce.
 * Un 404 siempre significa recurso inexistente; el resto se decide por el
 * numero de la respuesta porque cada servicio usa su propia vocabulary.
 */
function codigoDesde(status: number): ApiErrorCode {
  if (status === 404) return 'NOT_FOUND';
  if (status === 400 || status === 422) return 'VALIDATION';
  return 'NETWORK';
}

function mensajeDeError(status: number, cuerpo: ErrorDTO): string {
  const mensaje = cuerpo.mensaje?.trim();
  if (mensaje) return mensaje;
  if (status === 404) return 'No se encontro el recurso solicitado.';
  if (status === 400 || status === 422) return 'La solicitud no cumple el formato requerido.';
  return `El backend respondio con estado ${status}.`;
}

/** Lee el cuerpo como JSON sin lanzar: un 502 de un proxy no es JSON valido. */
async function leerJson(response: Response): Promise<unknown> {
  const texto = await response.text();
  if (!texto) return undefined;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Cuerpo ya serializado. El content-type lo fija esta funcion. */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Ejecuta la peticion y devuelve el cuerpo tipado.
 *
 * El timeout es propio y no se apoya solo en el del navegador: si la VM se
 * cuelga, el estudiante veria el boton "Enviando..." indefinidamente, y eso
 * es justamente el pico de concurrencia que esta practica debe manejar.
 */
export async function pedir<T>(base: string, ruta: string, opciones: RequestOptions = {}): Promise<T> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), apiConfig.timeoutMs);

  if (opciones.signal) {
    opciones.signal.addEventListener('abort', () => controlador.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${base}${ruta}`, {
      method: opciones.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opciones.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      signal: controlador.signal,
      cache: 'no-store',
    });
  } catch (reason) {
    if (controlador.signal.aborted && !opciones.signal?.aborted) {
      throw new ApiError('TIMEOUT', MENSAJE_TIMEOUT, 408);
    }
    if (opciones.signal?.aborted) throw reason;
    throw new ApiError('NETWORK', MENSAJE_SIN_CONEXION, 0);
  } finally {
    clearTimeout(temporizador);
  }

  const crudo = await leerJson(response);

  if (!response.ok) {
    const cuerpo = esObjeto(crudo) ? (crudo as ErrorDTO) : {};
    throw new ApiError(
      codigoDesde(response.status),
      mensajeDeError(response.status, cuerpo),
      response.status,
      cuerpo.requestId,
    );
  }

  if (response.status === 204 || crudo === undefined) {
    return undefined as T;
  }
  return crudo as T;
}

/**
 * La respuesta 202 del productor no trae cuerpo de reserva: trae el
 * identificador de seguimiento. Este helper obliga a que el codigo del
 * cliente verifique que exista, en vez de propagar `undefined` y fallar mas
 * abajo con un error incomprensible.
 */
export function exigir<T>(valor: T | undefined | null, mensaje: string): T {
  if (valor === undefined || valor === null) {
    throw new ApiError('INVALID_RESPONSE', mensaje, 200);
  }
  return valor;
}