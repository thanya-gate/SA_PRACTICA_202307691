import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogClient } from '@/components/pages/CatalogClient';
import { listarEventos } from '@/lib/api/academix-api';

let mockPathname = '/';

/**
 * CatalogClient ya no lee la query string (el escenario `?scenario=` era del
 * mock de la Practica 7), pero SiteHeader, que envuelve a toda vista, si usa
 * `usePathname`.
 */
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/lib/api/academix-api', () => ({
  listarEventos: jest.fn(),
}));

const mockedListarEventos = jest.mocked(listarEventos);

const evento = {
  eventId: 'EVT-2026-001',
  title: 'Arquitectura de microservicios con eventos',
  course: 'Software Avanzado',
  speaker: 'Ing. Thanya Vargas',
  date: '05/10/2026 · 15:00',
  modality: 'Presencial',
  availableSeats: 12,
  totalSeats: 30,
  state: 'Programado',
};

describe('Catálogo de eventos', () => {
  beforeEach(() => {
    mockPathname = '/';
    mockedListarEventos.mockReset();
  });

  it('muestra los eventos que devuelve el servicio y permite filtrar', async () => {
    mockedListarEventos
      .mockResolvedValueOnce({ eventos: [evento], total: 1, origenCache: false })
      .mockResolvedValueOnce({ eventos: [], total: 0, origenCache: false });

    render(<CatalogClient />);
    expect(await screen.findByText('Arquitectura de microservicios con eventos')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar evento'), 'inexistente');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(screen.getByText('No hay resultados')).toBeInTheDocument());
    expect(mockedListarEventos).toHaveBeenLastCalledWith('inexistente');
  });

  it('informa de donde vienen los datos', async () => {
    mockedListarEventos.mockResolvedValue({ eventos: [evento], total: 1, origenCache: true });
    render(<CatalogClient />);

    expect(await screen.findByText(/Catálogo · caché Redis/)).toBeInTheDocument();
    expect(mockedListarEventos).toHaveBeenCalledWith('');
  });

  it('muestra el estado de error y permite reintentar', async () => {
    mockedListarEventos
      .mockRejectedValueOnce(new Error('No se pudo contactar al backend.'))
      .mockResolvedValueOnce({ eventos: [], total: 0, origenCache: false });
    render(<CatalogClient />);

    expect(await screen.findByText('No se pudo contactar al backend.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay resultados')).toBeInTheDocument();
  });
});