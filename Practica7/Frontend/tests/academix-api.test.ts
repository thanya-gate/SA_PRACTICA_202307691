/**
 * Pruebas del borde HTTP contra la VM.
 *
 * Aqui NO se simula la logica de negocio: se comprueba que el frontend habla
 * el idioma real de los tres servicios, que traduce las enumeraciones que
 * viajan como numeros y que traduce los errores sin perder el codigo.
 *
 * `fetch` se sustituye por un doble, asi que las pruebas corren sin la malla
 * SOA levantada pero contra las mismas rutas y cuerpos que usa Vercel.
 */

import {
  listarEventos,
  obtenerEvento,
  consultarEstado,
  solicitarReserva,
  verificarCredencial,
  obtenerMetricas,
} from '@/lib/api/academix-api';
import { ApiError } from '@/lib/api/http';
import { apiConfig } from '@/lib/config';

type Respuesta = { status?: number; body?: unknown; texto?: string };

/**
 * El entorno jsdom de esta version de Jest no expone `fetch`, asi que no
 * sirve `jest.spyOn(global, 'fetch')`: se asigna directamente y se restaura
 * al terminar cada prueba.
 */
const fetchOriginal = global.fetch;

function doblarFetch(doble: jest.Mock): void {
  (global as unknown as { fetch: unknown }).fetch = doble;
}

function restaurarFetch(): void {
  (global as unknown as { fetch: unknown }).fetch = fetchOriginal;
}

function responder({ status = 200, body, texto }: Respuesta): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => texto ?? (body === undefined ? '' : JSON.stringify(body)),
  });
}

function cuerpoDe(mock: jest.Mock): [string, RequestInit] {
  return [mock.mock.calls[0][0] as string, mock.mock.calls[0][1] as RequestInit];
}

describe('configuracion de endpoints', () => {
  it('expone un origen por servicio', () => {
    expect(apiConfig.catalogo).toMatch(/^https?:\/\//);
    expect(apiConfig.reservas).toMatch(/^https?:\/\//);
    expect(apiConfig.certificados).toMatch(/^https?:\/\//);
    expect(apiConfig.pollingMaxIntentos).toBeGreaterThan(0);
  });
});

describe('Servicio de Catalogo de Talleres', () => {
  afterEach(restaurarFetch);

  it('traduce el listado y la enumeracion numerica de estado', async () => {
    const fetchMock = responder({
      body: {
        eventos: [
          {
            eventoId: 'EVT-2026-001',
            titulo: 'Arquitectura de microservicios con eventos',
            curso: 'Software Avanzado',
            ponente: 'Ing. Thanya Vargas',
            fecha: '2026-10-05T15:00:00Z',
            modalidad: 'Presencial',
            cuposDisponibles: 24,
            cuposTotales: 30,
            estado: 1,
          },
        ],
        total: 1,
        origenCache: true,
      },
    });
    doblarFetch(fetchMock);

    const resultado = await listarEventos('microservicios');

    expect(resultado.origenCache).toBe(true);
    expect(resultado.total).toBe(1);
    expect(resultado.eventos[0]).toMatchObject({
      eventId: 'EVT-2026-001',
      title: 'Arquitectura de microservicios con eventos',
      speaker: 'Ing. Thanya Vargas',
      availableSeats: 24,
      state: 'Programado',
    });
    expect(resultado.eventos[0].date).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/);

    const [url] = cuerpoDe(fetchMock);
    expect(url).toContain('/api/talleres/eventos?');
    expect(url).toContain('busqueda=microservicios');
  });

  it('traduce el detalle con sus prerrequisitos', async () => {
    doblarFetch(responder({
        body: {
          evento: {
            eventoId: 'EVT-2026-002',
            titulo: 'Observabilidad',
            curso: 'Software Avanzado',
            ponente: 'Ing. Carlos Recinos',
            correoPonente: 'carlos.recinos@usac.edu.gt',
            fecha: '2026-10-12T15:00:00Z',
            modalidad: 'Hibrida',
            descripcion: 'Metricas y trazas.',
            cuposDisponibles: 10,
            cuposTotales: 20,
            prerrequisitos: ['Haber aprobado el taller anterior.'],
            estado: 2,
          },
          origenCache: false,
        },
      }),
    );

    await expect(obtenerEvento('EVT-2026-002')).resolves.toMatchObject({
      speakerEmail: 'carlos.recinos@usac.edu.gt',
      description: 'Metricas y trazas.',
      prerequisites: ['Haber aprobado el taller anterior.'],
      state: 'En curso',
    });
  });

  it('degrada la fecha invalida al texto original en vez de "Invalid Date"', async () => {
    doblarFetch(responder({
        body: {
          eventos: [
            {
              eventoId: 'EVT-9',
              titulo: 'T',
              curso: 'C',
              ponente: 'P',
              fecha: 'no-es-fecha',
              modalidad: 'Virtual',
              cuposDisponibles: 1,
              cuposTotales: 1,
              estado: 0,
            },
          ],
          total: 1,
          origenCache: false,
        },
      }),
    );

    const resultado = await listarEventos();
    expect(resultado.eventos[0].date).toBe('no-es-fecha');
    expect(resultado.eventos[0].state).toBe('Sin estado');
  });
});

describe('Servicio de Reservas / Ticketing (productor)', () => {
  afterEach(restaurarFetch);

  it('envia la solicitud en el vocabulario del productor y devuelve el seguimiento', async () => {
    const fetchMock = responder({
      status: 202,
      body: {
        trackingId: 'TRK-42',
        estado: 'PENDIENTE',
        mensaje: 'La solicitud fue recibida y esta en cola de procesamiento.',
        urlSeguimiento: '/api/reservas/TRK-42/estado',
      },
    });
    doblarFetch(fetchMock);

    const aceptada = await solicitarReserva({
      eventId: 'EVT-2026-001',
      studentName: 'Estudiante de prueba',
      studentEmail: 'estudiante@usac.edu.gt',
    });

    expect(aceptada).toMatchObject({ trackingId: 'TRK-42', status: 'PENDIENTE' });

    const [url, opciones] = cuerpoDe(fetchMock);
    expect(url).toBe(`${apiConfig.reservas}/api/reservas`);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body as string)).toEqual({
      eventoId: 'EVT-2026-001',
      estudianteNombre: 'Estudiante de prueba',
      estudianteCorreo: 'estudiante@usac.edu.gt',
      canal: 'web',
    });
  });

  it('falla de forma explicita si el 202 no trae identificador de seguimiento', async () => {
    doblarFetch(responder({ status: 202, body: { estado: 'PENDIENTE' } }));

    await expect(
      solicitarReserva({ eventId: 'E', studentName: 'Estudiante', studentEmail: 'a@usac.edu.gt' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('traduce 422 del productor a un error de validacion con el mensaje del servicio', async () => {
    doblarFetch(responder({
        status: 422,
        body: {
          codigo: 'SOLICITUD_INVALIDA',
          mensaje: 'la solicitud no cumple el formato requerido: use un correo institucional',
          requestId: 'req-9',
        },
      }),
    );

    const error = await solicitarReserva({
      eventId: 'E',
      studentName: 'Estudiante',
      studentEmail: 'alguien@ejemplo.com',
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'VALIDATION', status: 422, requestId: 'req-9' });
    expect((error as ApiError).message).toMatch(/correo institucional/);
  });

  it('traduce el estado pendiente sin marcarlo como resuelto', async () => {
    doblarFetch(responder({
        body: {
          trackingId: 'TRK-42',
          estado: 'PENDIENTE',
          mensaje: 'La solicitud aun no ha sido resuelta por el worker.',
          encontrado: false,
        },
      }),
    );

    const seguimiento = await consultarEstado('TRK-42');
    expect(seguimiento).toMatchObject({ status: 'PENDIENTE', resolved: false });
    expect(seguimiento.ticket).toBeUndefined();
  });

  it('expone el pase firmado cuando el worker resolvio la solicitud', async () => {
    doblarFetch(responder({
        body: {
          trackingId: 'TRK-42',
          reservaId: 'RSV-1',
          estado: 'CONFIRMADA',
          mensaje: 'Reserva confirmada.',
          procesadoEn: '2026-10-05T15:00:00Z',
          encontrado: true,
          ticket: {
            ticketId: 'CERT-2026-000742',
            codigoValidacion: 'CERT-2026-000742',
            firma: 'firma-32',
            emitidoEn: '2026-10-05T15:00:00Z',
            eventoTitulo: 'Arquitectura de microservicios con eventos',
            titular: 'Estudiante de prueba',
          },
        },
      }),
    );

    const seguimiento = await consultarEstado('TRK-42');
    expect(seguimiento).toMatchObject({ status: 'CONFIRMADA', resolved: true, reservationId: 'RSV-1' });
    expect(seguimiento.ticket).toMatchObject({
      validationCode: 'CERT-2026-000742',
      signature: 'firma-32',
      holder: 'Estudiante de prueba',
    });
  });

  it('trata un estado desconocido como PENDIENTE en vez de romper la interfaz', async () => {
    doblarFetch(responder({ body: { trackingId: 'T', estado: 'NUEVO_ESTADO', mensaje: 'm', encontrado: false } }),
    );

    await expect(consultarEstado('T')).resolves.toMatchObject({ status: 'PENDIENTE' });
  });

  it('lee los contadores del broker', async () => {
    doblarFetch(responder({
        body: { publicadas: 30, confirmadasBroker: 30, rechazadasBroker: 0, duplicadas: 2 },
      }),
    );

    await expect(obtenerMetricas()).resolves.toEqual({
      publicadas: 30,
      confirmadasBroker: 30,
      rechazadasBroker: 0,
      duplicadas: 2,
    });
  });
});

describe('Servicio de Certificados', () => {
  afterEach(restaurarFetch);

  it.each([
    [1, 'VÁLIDA'],
    [2, 'INVÁLIDA'],
    [3, 'NO_ENCONTRADA'],
  ] as const)('traduce el estado %s a %s', async (numero, esperado) => {
    doblarFetch(responder({
        body: {
          codigo: 'CERT-2026-000742',
          estado: numero,
          estadoTexto: 'X',
          titulo: 'Taller',
          titular: 'Estudiante',
          emitidoEn: '2026-10-05T15:00:00Z',
          mensaje: 'Mensaje del servicio.',
        },
      }),
    );

    await expect(verificarCredencial('CERT-2026-000742')).resolves.toMatchObject({ status: esperado });
  });

  it('no expone el titulo cuando la credencial no existe', async () => {
    doblarFetch(responder({
        body: {
          codigo: 'CERT-X',
          estado: 3,
          estadoTexto: 'NO_ENCONTRADA',
          titulo: '',
          titular: '',
          emitidoEn: '',
          mensaje: 'No se encontro ninguna credencial.',
        },
      }),
    );

    const resultado = await verificarCredencial('CERT-X');
    expect(resultado.status).toBe('NO_ENCONTRADA');
    expect(resultado.title).toBe('Credencial no encontrada');
  });
});

describe('errores de transporte', () => {
  afterEach(restaurarFetch);

  it('traduce un rechazo de red a NETWORK', async () => {
    doblarFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await listarEventos().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('traduce 404 a NOT_FOUND con el mensaje del servicio', async () => {
    doblarFetch(responder({
        status: 404,
        body: { codigo: 'EVENTO_NO_ENCONTRADO', mensaje: 'No se encontro el evento solicitado.' },
      }),
    );

    await expect(obtenerEvento('EVT-X')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No se encontro el evento solicitado.',
    });
  });

  it('no revienta cuando la respuesta de error no es JSON', async () => {
    doblarFetch(responder({ status: 502, texto: '<html>Bad Gateway</html>' }),
    );

    const error = await listarEventos().catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'NETWORK', status: 502 });
    expect((error as ApiError).message).toBe('El backend respondio con estado 502.');
  });

  it('rechaza un 200 sin cuerpo en vez de propagar undefined', async () => {
    doblarFetch(responder({ status: 200 }));
    await expect(listarEventos()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});