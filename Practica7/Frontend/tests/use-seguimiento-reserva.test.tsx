/**
 * Pruebas del polling del seguimiento.
 *
 * Es la logica que hace que el flujo asincrono sea visible sin romper al
 * estudiante: reintenta ante un fallo de red, se detiene en cuanto el worker
 * responde y no manda consultas infinitas.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { consultarEstado } from '@/lib/api/academix-api';
import { esTerminal, useSeguimientoReserva } from '@/lib/use-seguimiento-reserva';

jest.mock('@/lib/api/academix-api', () => ({
  consultarEstado: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  const real = jest.requireActual('@/lib/config');
  return {
    ...real,
    apiConfig: { ...real.apiConfig, pollingIntervalMs: 5, pollingMaxIntentos: 3 },
  };
});

const mockedConsultarEstado = jest.mocked(consultarEstado);

const PENDIENTE = {
  trackingId: 'TRK-1',
  status: 'PENDIENTE' as const,
  message: 'En cola.',
  resolved: false,
};

const CONFIRMADA = {
  trackingId: 'TRK-1',
  reservationId: 'RSV-1',
  status: 'CONFIRMADA' as const,
  message: 'Reserva confirmada.',
  resolved: true,
};

describe('esTerminal', () => {
  it('considera terminal cualquier estado distinto de PENDIENTE', () => {
    expect(esTerminal(null)).toBe(false);
    expect(esTerminal(PENDIENTE)).toBe(false);
    expect(esTerminal(CONFIRMADA)).toBe(true);
  });
});

describe('useSeguimientoReserva', () => {
  beforeEach(() => {
    mockedConsultarEstado.mockReset();
  });

  it('empieza consultando y resuelve en cuanto el worker responde', async () => {
    mockedConsultarEstado.mockResolvedValue(CONFIRMADA);
    const { result } = renderHook(() => useSeguimientoReserva('TRK-1'));

    expect(result.current.fase).toBe('consultando');
    await waitFor(() => expect(result.current.fase).toBe('resuelto'));
    expect(result.current.seguimiento?.status).toBe('CONFIRMADA');
    expect(mockedConsultarEstado).toHaveBeenCalledTimes(1);
  });

  it('insiste hasta agotar los intentos y conserva el ultimo estado', async () => {
    mockedConsultarEstado.mockResolvedValue(PENDIENTE);
    const { result } = renderHook(() => useSeguimientoReserva('TRK-1'));

    await waitFor(() => expect(result.current.fase).toBe('agotado'));
    expect(mockedConsultarEstado).toHaveBeenCalledTimes(3);
    expect(result.current.intentos).toBe(3);
    expect(result.current.seguimiento?.status).toBe('PENDIENTE');
  });

  it('reintenta tras un fallo de red en lugar de abandonar la solicitud', async () => {
    mockedConsultarEstado
      .mockRejectedValueOnce(new Error('No se pudo contactar al backend.'))
      .mockResolvedValue(CONFIRMADA);
    const { result } = renderHook(() => useSeguimientoReserva('TRK-1'));

    await waitFor(() => expect(result.current.fase).toBe('resuelto'));
    expect(mockedConsultarEstado.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('se rinde tras agotar los intentos, deja de consultar y permite reintento manual', async () => {
    mockedConsultarEstado.mockResolvedValue(PENDIENTE);
    const { result } = renderHook(() => useSeguimientoReserva('TRK-1'));

    await waitFor(() => expect(result.current.fase).toBe('agotado'));
    expect(result.current.error).toMatch(/sigue en cola/);

    // Agotado significa agotado: no se sigueameda la VM en segundo plano.
    const llamadas = mockedConsultarEstado.mock.calls.length;
    await new Promise((resolver) => setTimeout(resolver, 40));
    expect(mockedConsultarEstado).toHaveBeenCalledTimes(llamadas);

    act(() => {
      result.current.consultar();
    });
    await waitFor(() => expect(mockedConsultarEstado.mock.calls.length).toBeGreaterThan(llamadas));
  });

  it('vuelve a consultar el mismo identificador al cambiar el disparador', async () => {
    mockedConsultarEstado.mockResolvedValue(CONFIRMADA);
    const { result, rerender } = renderHook(
      ({ id, disparo }) => useSeguimientoReserva(id, true, disparo),
      { initialProps: { id: 'TRK-1', disparo: 0 } },
    );

    await waitFor(() => expect(result.current.fase).toBe('resuelto'));
    expect(mockedConsultarEstado).toHaveBeenCalledTimes(1);

    // Es el caso de /reservas?trackingId=TRK-1: el campo ya viene relleno y
    // `setState` con el mismo valor no dispara nada sin el disparador.
    rerender({ id: 'TRK-1', disparo: 1 });
    await waitFor(() => expect(mockedConsultarEstado).toHaveBeenCalledTimes(2));
  });

  it('no consulta nada sin identificador', async () => {
    const { result } = renderHook(() => useSeguimientoReserva('   '));

    await waitFor(() => expect(result.current.fase).toBe('idle'));
    expect(result.current.error).toMatch(/identificador de seguimiento/);
    expect(mockedConsultarEstado).not.toHaveBeenCalled();
  });

  it('cancela la peticion en vuelo al desmontar', async () => {
    let signal: AbortSignal | undefined;
    mockedConsultarEstado.mockImplementation((_id: string, opciones?: { signal?: AbortSignal }) => {
      signal = opciones?.signal;
      return new Promise(() => undefined);
    });

    const { unmount } = renderHook(() => useSeguimientoReserva('TRK-1'));
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});