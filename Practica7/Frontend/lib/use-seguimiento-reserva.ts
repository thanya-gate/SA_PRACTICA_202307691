'use client';

/**
 * Polling del seguimiento de una reserva.
 *
 * Es la pieza que hace visible el flujo asincrono del enunciado: el productor
 * respondio 202 y el resultado lo escribe el worker. La unica forma de que el
 * estudiante vea el progreso es preguntar cada cierto tiempo.
 *
 * Deliberadamente NO usa SSE ni WebSocket: leer la cache de seguimiento por
 * HTTP cada 2.5 s es lo que el enunciado describe y no obliga al backend a
 * mantener conexiones abiertas, que es justo lo que se cae cuando miles de
 * estudiantes se registran en el mismo segundo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { consultarEstado, type SeguimientoReserva } from '@/lib/api/academix-api';
import { apiConfig } from '@/lib/config';

export type FaseSeguimiento = 'idle' | 'consultando' | 'esperando' | 'resuelto' | 'agotado';

export interface EstadoSeguimiento {
  fase: FaseSeguimiento;
  seguimiento: SeguimientoReserva | null;
  error: string | null;
  /** Consultas hechas hasta ahora. Se muestra para que el proceso sea transparente. */
  intentos: number;
}

const SIN_INTENTOS: EstadoSeguimiento = {
  fase: 'idle',
  seguimiento: null,
  error: null,
  intentos: 0,
};

const MENSAJE_AGOTADO =
  'La solicitud sigue en cola. El worker la procesara en cuanto tenga capacidad; puedes seguir consultando manualmente.';

/**
 * Los estados terminales son aquellos en los que el worker ya escribio el
 * resultado. En cuanto se llega a uno, el polling se detiene: seguir preguntando
 * es trabajo inutil para el estudiante y carga para la VM.
 */
export function esTerminal(seguimiento: SeguimientoReserva | null): boolean {
  if (!seguimiento) return false;
  return seguimiento.status !== 'PENDIENTE' || seguimiento.resolved;
}

/**
 * @param trackingId Identificador a consultar.
 * @param activo Permite montar el componente sin disparar consultas.
 * @param disparador Se incrementa al pulsar "Consultar" para que repetir el
 *   MISMO identificador vuelva a arrancar el polling. Sin esto, `setState` con
 *   un valor identico es un no-op y el formulario aparenta estar roto: es justo
 *   lo que pasa al llegar por `/reservas?trackingId=...`, donde el campo ya
 *   viene relleno y el boton no haria nada.
 */
export function useSeguimientoReserva(trackingId: string, activo = true, disparador = 0) {
  const [estado, setEstado] = useState<EstadoSeguimiento>(SIN_INTENTOS);

  /**
   * Cada ciclo de polling tiene su propio AbortController y su propio numero
   * de generacion. Sin esa separacion, reutilizar un controller ya abortado
   * haria fallar cada consulta posterior de forma instantanea e invisible.
   */
  const generacion = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelacion = useRef<AbortController | null>(null);

  /**
   * Espejo del estado para leer e incrementar `intentos` sin depender del
   * valor capturado por el cierre de `consultar`, que se recrea en cada
   * render y haria el contador retroceder. Todo el estado pasa por `publicar`
   * para que el espejo nunca quede atras: si se desincroniza, el contador de
   * consultas muestra cifras que no corresponden a la pantalla.
   */
  const estadoRef = useRef<EstadoSeguimiento>(SIN_INTENTOS);
  const publicar = useCallback((siguiente: EstadoSeguimiento) => {
    estadoRef.current = siguiente;
    setEstado(siguiente);
  }, []);

  const detener = useCallback(() => {
    generacion.current += 1;
    if (temporizador.current !== null) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    cancelacion.current?.abort();
    cancelacion.current = null;
  }, []);

  const consultar = useCallback(async () => {
    const id = trackingId.trim();
    if (!id) {
      publicar({ ...SIN_INTENTOS, error: 'Ingresa un identificador de seguimiento.' });
      return;
    }

    generacion.current += 1;
    const miGeneracion = generacion.current;
    const controller = new AbortController();
    cancelacion.current = controller;

    const previos = estadoRef.current;
    publicar({
      ...previos,
      fase: previos.intentos === 0 ? 'consultando' : 'esperando',
      error: null,
    });

    /** Si el ciclo cambio mientras esperabamos, la respuesta ya no interesa. */
    const vigente = () => generacion.current === miGeneracion;

    const programar = (estadoNuevo: EstadoSeguimiento) => {
      publicar(estadoNuevo);
      temporizador.current = setTimeout(() => void consultar(), apiConfig.pollingIntervalMs);
    };

    try {
      const seguimiento = await consultarEstado(id, { signal: controller.signal });
      if (!vigente()) return;

      const intentos = estadoRef.current.intentos + 1;

      if (esTerminal(seguimiento)) {
        publicar({ fase: 'resuelto', seguimiento, error: null, intentos });
        return;
      }

      if (intentos >= apiConfig.pollingMaxIntentos) {
        publicar({ fase: 'agotado', seguimiento, error: MENSAJE_AGOTADO, intentos });
        return;
      }

      programar({ fase: 'esperando', seguimiento, error: null, intentos });
    } catch (reason: unknown) {
      if (!vigente() || esAbortacion(reason)) return;

      const intentos = estadoRef.current.intentos + 1;
      const mensaje = mensajeDe(reason);

      // Un fallo puntual de red no abandona el seguimiento: la solicitud
      // sigue en la cola, asi que se reintenta mientras queden intentos.
      if (intentos < apiConfig.pollingMaxIntentos) {
        programar({ fase: 'esperando', seguimiento: null, error: mensaje, intentos });
        return;
      }

      publicar({ fase: 'agotado', seguimiento: null, error: mensaje, intentos });
    }
  }, [publicar, trackingId]);

  const consultarYAReintentar = useCallback(() => {
    detener();
    publicar({ fase: 'consultando', seguimiento: null, error: null, intentos: 0 });
    void consultar();
  }, [consultar, detener, publicar]);

  useEffect(() => {
    if (!activo) {
      detener();
      return;
    }

    if (!trackingId.trim()) {
      publicar({ ...SIN_INTENTOS, error: 'Ingresa un identificador de seguimiento.' });
      return;
    }

    void consultar();
    return detener;
  }, [activo, consultar, detener, disparador, publicar, trackingId]);

  return { ...estado, consultar: consultarYAReintentar };
}

/**
 * `fetch` rechaza con un `DOMException` al abortar. Se comprueba el nombre y
 * no solo `instanceof Error` para no depender de la jerarquia de prototipos
 * del entorno.
 */
function esAbortacion(reason: unknown): boolean {
  if (reason === null || typeof reason !== 'object') return false;
  return (reason as { name?: unknown }).name === 'AbortError';
}

function mensajeDe(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'No se pudo consultar el estado de la reserva.';
}