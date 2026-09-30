import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialClient } from '@/components/pages/CredentialClient';
import { verificarCredencial } from '@/lib/api/academix-api';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/verificar',
}));

jest.mock('@/lib/api/academix-api', () => ({
  verificarCredencial: jest.fn(),
}));

const mockedVerificarCredencial = jest.mocked(verificarCredencial);

describe('Verificación de credencial', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockedVerificarCredencial.mockReset();
  });

  it('muestra una credencial válida y sus datos públicos', async () => {
    mockedVerificarCredencial.mockResolvedValue({
      identifier: 'CERT-2026-000742',
      status: 'VÁLIDA',
      title: 'Taller de Arquitectura SOA',
      holder: 'Estudiante de prueba',
      issuedAt: '20/10/2026',
      message: 'Credencial válida.',
    });
    render(<CredentialClient />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Identificador o hash'), 'CERT-2026-000742');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByText('Credencial verificada')).toBeInTheDocument();
    expect(screen.getByText('Estudiante de prueba')).toBeInTheDocument();
  });

  it('valida el formato antes de consultar', async () => {
    render(<CredentialClient />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Identificador o hash'), '??');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(screen.getByText(/Usa entre 6 y 64 caracteres/)).toBeInTheDocument();
    expect(mockedVerificarCredencial).not.toHaveBeenCalled();
  });

  it('muestra estados no encontrada y error del servicio', async () => {
    mockedVerificarCredencial.mockResolvedValueOnce({
      identifier: 'CERT-NO-ENCONTRADA',
      status: 'NO_ENCONTRADA',
      title: 'Credencial no encontrada',
      message: 'No existe.',
    });
    render(<CredentialClient />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Identificador o hash'), 'CERT-NO-ENCONTRADA');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Credencial no encontrada')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nueva consulta' }));
    mockedVerificarCredencial.mockRejectedValueOnce(new Error('Servicio no disponible.'));
    await user.type(screen.getByLabelText('Identificador o hash'), 'CERT-ERROR');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Servicio no disponible.')).toBeInTheDocument();
  });
});
