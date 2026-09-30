import { render, screen } from '@testing-library/react';
import { EventDetailClient } from '@/components/pages/EventDetailClient';
import { consultarDisponibilidad, obtenerEvento } from '@/lib/api/academix-api';

let mockSearchParams = new URLSearchParams('eventId=EVT-2026-001');

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/evento',
}));

jest.mock('@/lib/api/academix-api', () => ({
  obtenerEvento: jest.fn(),
  consultarDisponibilidad: jest.fn(),
}));

const mockedObtenerEvento = jest.mocked(obtenerEvento);
const mockedConsultarDisponibilidad = jest.mocked(consultarDisponibilidad);

const evento = {
  eventId: 'EVT-2026-001',
  title: 'Arquitectura de microservicios con eventos',
  course: 'Software Avanzado',
  speaker: 'Ing. Thanya Vargas',
  speakerEmail: 'thanya.vargas@usac.edu.gt',
  date: '05/10/2026 · 15:00',
  modality: 'Presencial',
  availableSeats: 12,
  totalSeats: 30,
  description: 'Descripción del evento',
  prerequisites: ['Fundamentos'],
  state: 'Programado',
};

function conCupos(disponibles: number) {
  mockedObtenerEvento.mockResolvedValue(evento);
  mockedConsultarDisponibilidad.mockResolvedValue({
    disponibles,
    total: 30,
    admiteReserva: true,
  });
}

describe('Detalle del evento', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams('eventId=EVT-2026-001');
    mockedObtenerEvento.mockReset();
    mockedConsultarDisponibilidad.mockReset();
  });

  it('habilita la reserva cuando hay cupos', async () => {
    conCupos(12);
    render(<EventDetailClient />);

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Iniciar reserva' })).toHaveAttribute(
      'href',
      '/reservar?eventId=EVT-2026-001',
    );
  });

  it('bloquea la reserva cuando el evento no tiene cupo', async () => {
    conCupos(0);
    render(<EventDetailClient />);

    expect(await screen.findByText('SIN_CUPO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserva no disponible' })).toBeDisabled();
  });

  it('toma el contador de la disponibilidad en vivo y no del detalle cacheado', async () => {
    mockedObtenerEvento.mockResolvedValue({ ...evento, availableSeats: 12 });
    mockedConsultarDisponibilidad.mockResolvedValue({ disponibles: 3, total: 30, admiteReserva: true });
    render(<EventDetailClient />);

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('muestra el evento inexistente como error', async () => {
    mockedObtenerEvento.mockRejectedValue(new Error('No se encontro el evento solicitado.'));
    mockedConsultarDisponibilidad.mockRejectedValue(new Error('No se encontro el evento solicitado.'));
    render(<EventDetailClient />);

    expect(await screen.findByText('No se encontro el evento solicitado.')).toBeInTheDocument();
  });
});