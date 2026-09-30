import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationClient } from '@/components/pages/ReservationClient';
import { obtenerEvento, solicitarReserva } from '@/lib/api/academix-api';

let mockSearchParams = new URLSearchParams('eventId=EVT-2026-001');
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/reservar',
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api/academix-api', () => ({
  obtenerEvento: jest.fn(),
  solicitarReserva: jest.fn(),
}));

const mockedObtenerEvento = jest.mocked(obtenerEvento);
const mockedSolicitarReserva = jest.mocked(solicitarReserva);

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
  description: 'Descripción',
  prerequisites: [],
  state: 'Programado',
};

describe('Solicitud de reserva', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams('eventId=EVT-2026-001');
    mockPush.mockReset();
    mockedObtenerEvento.mockReset().mockResolvedValue(evento);
    mockedSolicitarReserva.mockReset();
  });

  it('valida los datos obligatorios', async () => {
    render(<ReservationClient />);
    expect(await screen.findByText('Datos del estudiante')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Nombre completo'));
    await user.clear(screen.getByLabelText('Correo electrónico'));
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(screen.getByText('Ingresa el nombre completo.')).toBeInTheDocument();
    expect(screen.getByText('Ingresa un correo electrónico.')).toBeInTheDocument();
    expect(mockedSolicitarReserva).not.toHaveBeenCalled();
  });

  it('rechaza un correo de un dominio que el productor no admite', async () => {
    render(<ReservationClient />);
    expect(await screen.findByText('Datos del estudiante')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Correo electrónico'));
    await user.type(screen.getByLabelText('Correo electrónico'), 'alguien@ejemplo.com');
    await user.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(screen.getByText(/Usa un correo institucional/)).toBeInTheDocument();
    expect(mockedSolicitarReserva).not.toHaveBeenCalled();
  });

  it('envía la solicitud, recibe 202 y navega con el identificador de seguimiento', async () => {
    mockedSolicitarReserva.mockResolvedValue({
      trackingId: '3f1c0b6e-6f1a-4a1e-9c2b-1f0a2b3c4d5e',
      status: 'PENDIENTE',
      message: 'La solicitud fue recibida y esta en cola de procesamiento.',
      followUpUrl: '/api/reservas/3f1c0b6e/estado',
    });
    render(<ReservationClient />);
    expect(await screen.findByText('Datos del estudiante')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(mockedSolicitarReserva).toHaveBeenCalledWith({
      eventId: 'EVT-2026-001',
      studentName: 'Estudiante de prueba',
      studentEmail: 'estudiante@usac.edu.gt',
    });
    expect(mockPush).toHaveBeenCalledWith(
      '/reservas?trackingId=3f1c0b6e-6f1a-4a1e-9c2b-1f0a2b3c4d5e',
    );
  });

  it('muestra el error si el productor no acepta la solicitud', async () => {
    mockedSolicitarReserva.mockRejectedValue(
      new Error('la solicitud no cumple el formato requerido: use un correo institucional o de demostracion'),
    );
    render(<ReservationClient />);
    expect(await screen.findByText('Datos del estudiante')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    expect(await screen.findByText(/use un correo institucional/)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});