import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationStatusClient } from '@/components/pages/ReservationStatusClient';
import { consultarEstado } from '@/lib/api/academix-api';

let mockSearchParams = new URLSearchParams('trackingId=TRK-1');

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/reservas',
}));

jest.mock('@/lib/api/academix-api', () => ({
  consultarEstado: jest.fn(),
}));

/**
 * El polling de produccion espera 2.5 s entre consultas, mas lento que el
 * timeout por defecto de `findByText`. Aqui se acorta el intervalo para que la
 * prueba del reintento sea rapida; el valor real se lee igual desde el modulo.
 */
jest.mock('@/lib/config', () => {
  const real = jest.requireActual('@/lib/config');
  return {
    ...real,
    apiConfig: { ...real.apiConfig, pollingIntervalMs: 5, pollingMaxIntentos: 8 },
  };
});

const mockedConsultarEstado = jest.mocked(consultarEstado);

function pendiente() {
  return {
    trackingId: 'TRK-1',
    status: 'PENDIENTE' as const,
    message: 'La solicitud aun no ha sido resuelta por el worker.',
    resolved: false,
  };
}

function confirmada() {
  return {
    trackingId: 'TRK-1',
    reservationId: 'RSV-1',
    status: 'CONFIRMADA' as const,
    message: 'La reserva fue confirmada y el pase fue emitido.',
    processedAt: '2026-10-05T15:00:00Z',
    resolved: true,
    ticket: {
      ticketId: 'CERT-2026-000742',
      validationCode: 'CERT-2026-000742',
      signature: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      issuedAt: '05/10/2026 · 15:00',
      eventTitle: 'Arquitectura de microservicios con eventos',
      holder: 'Estudiante de prueba',
    },
  };
}

describe('Consulta del seguimiento de una reserva', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams('trackingId=TRK-1');
    mockedConsultarEstado.mockReset();
  });

  it('muestra el pase emitido por el worker cuando la reserva se confirma', async () => {
    mockedConsultarEstado.mockResolvedValue(confirmada());
    render(<ReservationStatusClient />);

    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
    expect(screen.getByText('CERT-2026-000742')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toBeInTheDocument();
    expect(mockedConsultarEstado).toHaveBeenCalledTimes(1);
  });

  it('muestra la solicitud en cola mientras el worker no responde', async () => {
    mockedConsultarEstado.mockResolvedValue(pendiente());
    render(<ReservationStatusClient />);

    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(screen.getByText(/En cola: el worker todavía no ha publicado el resultado/)).toBeInTheDocument();
    // El contador prueba que se sigue consultando, que es el mecanismo del flujo asincrono.
    await waitFor(() => expect(mockedConsultarEstado.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText(/Consultas realizadas: \d+/)).toBeInTheDocument();
  });

  it('vuelve a consultar hasta un estado terminal', async () => {
    mockedConsultarEstado
      .mockResolvedValueOnce(pendiente())
      .mockResolvedValueOnce(pendiente())
      .mockResolvedValue(confirmada());
    render(<ReservationStatusClient />);

    expect(await screen.findByText('Solicitud recibida')).toBeInTheDocument();
    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
    expect(mockedConsultarEstado.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('muestra una reserva rechazada sin pase', async () => {
    mockedConsultarEstado.mockResolvedValue({
      trackingId: 'TRK-1',
      status: 'RECHAZADA',
      message: 'La solicitud fue rechazada.',
      resolved: true,
    });
    render(<ReservationStatusClient />);

    expect(await screen.findByText('Reserva rechazada')).toBeInTheDocument();
    expect(screen.queryByText('Pase emitido por el worker')).not.toBeInTheDocument();
  });

  it('permite consultar un identificador escrito a mano', async () => {
    mockedConsultarEstado.mockResolvedValue(confirmada());
    mockSearchParams = new URLSearchParams();
    render(<ReservationStatusClient />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Identificador de seguimiento'), 'TRK-9');
    await user.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('Reserva confirmada')).toBeInTheDocument();
    expect(mockedConsultarEstado).toHaveBeenCalledWith('TRK-9', expect.anything());
  });

  it('avisa cuando no hay nada que consultar', async () => {
    mockSearchParams = new URLSearchParams();
    render(<ReservationStatusClient />);

    await waitFor(() =>
      expect(screen.getByText('Ingresa un identificador de seguimiento.')).toBeInTheDocument(),
    );
    expect(mockedConsultarEstado).not.toHaveBeenCalled();
  });
});