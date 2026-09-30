/**
 * Pruebas del Servicio de Catalogo de Talleres.
 *
 * Se prueban los casos de uso con dobles en memoria, sin PostgreSQL ni Redis.
 * La garantia de concurrencia real (un solo cupo para N estudiantes) se
 * verifica aparte contra la funcion fn_reclamar_cupo de PostgreSQL.
 */

import { CatalogoDeTalleres } from '../src/application/services/catalogo-de-talleres';
import { CacheEnMemoria } from '../src/infrastructure/cache/cache-en-memoria';
import { CatalogoEnMemoria } from '../src/infrastructure/persistence/postgres/catalogo-en-memoria';
import { crearAplicacionHttp } from '../src/interfaces/http/app';
import { admiteReserva, ResultadoCupo } from '../src/domain/evento';
import request from 'supertest';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function armar() {
  const repositorio = new CatalogoEnMemoria();
  repositorio.sembrar([
    { eventoId: 'EVT-1', titulo: 'Go avanzado', cuposTotales: 2, cuposDisponibles: 2 },
    { eventoId: 'EVT-2', titulo: 'Kafka', estado: 'FINALIZADO', cuposTotales: 5, cuposDisponibles: 5 },
    { eventoId: 'EVT-3', titulo: 'Cancelado', estado: 'CANCELADO', cuposTotales: 1, cuposDisponibles: 0 },
  ]);
  const cache = new CacheEnMemoria();
  const servicio = new CatalogoDeTalleres(repositorio, cache, 15, 30);
  return { repositorio, cache, servicio };
}

describe('CatalogoDeTalleres', () => {
  it('CU-P7-01 lista el catalogo excluyendo eventos cancelados', async () => {
    const { servicio } = armar();
    const resultado = await servicio.listarEventos({ busqueda: '', limite: 20, offset: 0, soloConCupo: false });

    expect(resultado.total).toBe(2);
    expect(resultado.eventos.map((e) => e.eventoId)).toEqual(['EVT-1', 'EVT-2']);
    expect(resultado.origenCache).toBe(false);
  });

  it('filtra por busqueda de texto sin distinguir mayusculas', async () => {
    const { servicio } = armar();
    const resultado = await servicio.listarEventos({ busqueda: 'kafka', limite: 20, offset: 0, soloConCupo: false });

    expect(resultado.total).toBe(1);
    expect(resultado.eventos[0]?.eventoId).toBe('EVT-2');
  });

  it('puede filtrar solo eventos con cupo disponible', async () => {
    const { repositorio, servicio } = armar();
    await repositorio.reclamarCupo('EVT-1', UUID_A);
    await repositorio.reclamarCupo('EVT-1', UUID_B);

    const resultado = await servicio.listarEventos({ busqueda: '', limite: 20, offset: 0, soloConCupo: true });

    expect(resultado.eventos.map((e) => e.eventoId)).toEqual(['EVT-2']);
  });

  it('sirve el listado desde cache en la segunda consulta y no vuelve a la base', async () => {
    const { repositorio, servicio } = armar();

    await servicio.listarEventos({ busqueda: '', limite: 20, offset: 0, soloConCupo: false });
    const segundo = await servicio.listarEventos({ busqueda: '', limite: 20, offset: 0, soloConCupo: false });

    expect(repositorio.llamadasListar).toBe(1);
    expect(segundo.origenCache).toBe(true);
  });

  it('limita el tamaño de pagina a un maximo razonable', async () => {
    const { repositorio, servicio } = armar();
    await servicio.listarEventos({ busqueda: '', limite: 5000, offset: -7, soloConCupo: false });

    expect(repositorio.llamadasListar).toBe(1);
  });

  it('CU-P7-02 devuelve el detalle con prerrequisitos', async () => {
    const { repositorio, servicio } = armar();
    repositorio.sembrar([{ eventoId: 'EVT-4', prerrequisitos: ['SQL', 'Docker'] }]);

    const { evento } = await servicio.obtenerEvento('EVT-4');

    expect(evento?.prerrequisitos).toEqual(['SQL', 'Docker']);
  });

  it('responde evento inexistente con null en vez de exception', async () => {
    const { servicio } = armar();
    const { evento } = await servicio.obtenerEvento('NO-EXISTE');

    expect(evento).toBeNull();
  });

  it('CU-P8-03 descuenta el cupo al reclamarlo', async () => {
    const { servicio } = armar();

    const claim = await servicio.reclamarCupo('EVT-1', UUID_A, 'ACAD-1');

    expect(claim.resultado).toBe(ResultadoCupo.ASIGNADO);
    expect(claim.cuposDisponibles).toBe(1);
    expect(claim.cuposTotales).toBe(2);
    expect(claim.mensaje).toContain('atomica');
  });

  it('no asigna mas cupos de los disponibles', async () => {
    const { servicio } = armar();
    await servicio.reclamarCupo('EVT-1', UUID_A, 'ACAD-1');
    await servicio.reclamarCupo('EVT-1', UUID_B, 'ACAD-2');

    const tercero = await servicio.reclamarCupo('EVT-1', UUID_A.replace('1', '3'), 'ACAD-3');

    expect(tercero.resultado).toBe(ResultadoCupo.SIN_CUPO);
    expect(tercero.cuposDisponibles).toBe(0);
  });

  it('rechaza reservar en un evento finalizado', async () => {
    const { servicio } = armar();

    const claim = await servicio.reclamarCupo('EVT-2', UUID_A, 'ACAD-1');

    expect(claim.resultado).toBe(ResultadoCupo.EVENTO_CERRADO);
  });

  it('invalida la cache del evento despues de cada movimiento de cupo', async () => {
    const { cache, servicio } = armar();
    await servicio.obtenerEvento('EVT-1');
    expect(cache.invalidaciones).not.toContain('EVT-1');

    await servicio.reclamarCupo('EVT-1', UUID_A, 'ACAD-1');

    expect(cache.invalidaciones).toContain('EVT-1');
  });

  it('liberar un cupo lo devuelve al evento', async () => {
    const { servicio } = armar();
    await servicio.reclamarCupo('EVT-1', UUID_A, 'ACAD-1');

    const liberado = await servicio.liberarCupo('EVT-1', UUID_A);

    expect(liberado.liberado).toBe(true);
    expect(liberado.cuposDisponibles).toBe(2);
  });

  it('admiteReserva solo vale para eventos activos', () => {
    expect(admiteReserva('PROGRAMADO')).toBe(true);
    expect(admiteReserva('EN_CURSO')).toBe(true);
    expect(admiteReserva('FINALIZADO')).toBe(false);
    expect(admiteReserva('CANCELADO')).toBe(false);
  });
});

describe('API HTTP del catalogo', () => {
  function app(origenesPermitidos: string[] = ['https://academix.vercel.app']) {
    const { servicio, repositorio, cache } = armar();
    return crearAplicacionHttp(servicio, {
      version: '2.0.0',
      origenesPermitidos,
      postgres: repositorio,
      cache,
    });
  }

  it('GET /api/talleres/eventos responde 200 con el listado', async () => {
    const res = await request(app()).get('/api/talleres/eventos');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.eventos[0].estado).toBe(1);
  });

  it('devuelve Access-Control-Allow-Origin al origen permitido', async () => {
    const res = await request(app())
      .get('/api/talleres/eventos')
      .set('Origin', 'https://academix.vercel.app');

    expect(res.headers['access-control-allow-origin']).toBe('https://academix.vercel.app');
  });

  it('omite Access-Control-Allow-Origin para un origen desconocido', async () => {
    const res = await request(app())
      .get('/api/talleres/eventos')
      .set('Origin', 'https://sitio-malicioso.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // El compose deja el origen permitido en "*" cuando no se define. Tratar ese
  // comodin como cadena literal hacia que ningun navegador obtuviera el
  // encabezado, y la respuesta se descartaba sin dejar rastro.
  it('el comodin habilita cualquier origen', async () => {
    const api = app(['*']);

    for (const origen of [
      'https://academix.vercel.app',
      'http://localhost:3000',
      'https://otro-anything.example',
    ]) {
      const res = await request(api).get('/api/talleres/eventos').set('Origin', origen);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });

  it('GET /api/talleres/eventos/:id responde 404 si no existe', async () => {
    const res = await request(app()).get('/api/talleres/eventos/NO-EXISTE');

    expect(res.status).toBe(404);
    expect(res.body.codigo).toBe('EVENTO_NO_ENCONTRADO');
  });

  it('POST /api/talleres/cupos responde 200 al asignar', async () => {
    const res = await request(app())
      .post('/api/talleres/cupos')
      .send({ eventoId: 'EVT-1', reservaId: UUID_A, trackingId: 'ACAD-1' });

    expect(res.status).toBe(200);
    expect(res.body.resultadoTexto).toBe('CUPO_ASIGNADO');
  });

  it('POST /api/talleres/cupos responde 409 cuando no hay cupo', async () => {
    const api = app();
    await request(api).post('/api/talleres/cupos').send({ eventoId: 'EVT-1', reservaId: UUID_A, trackingId: 'ACAD-1' });
    await request(api).post('/api/talleres/cupos').send({ eventoId: 'EVT-1', reservaId: UUID_B, trackingId: 'ACAD-2' });

    const res = await request(api)
      .post('/api/talleres/cupos')
      .send({ eventoId: 'EVT-1', reservaId: UUID_B.replace('2', '3'), trackingId: 'ACAD-3' });

    expect(res.status).toBe(409);
    expect(res.body.resultadoTexto).toBe('SIN_CUPO');
  });

  it('POST /api/talleres/cupos valida el cuerpo de la peticion', async () => {
    const res = await request(app()).post('/api/talleres/cupos').send({ eventoId: 'EVT-1' });

    expect(res.status).toBe(400);
  });

  it('responde 503 en salud cuando PostgreSQL no responde', async () => {
    const { servicio, cache } = armar();
    const api = crearAplicacionHttp(servicio, {
      version: '2.0.0',
      origenesPermitidos: ['*'],
      postgres: { ping: async () => { throw new Error('sin conexion'); } },
      cache,
    });

    const res = await request(api).get('/api/talleres/salud');

    expect(res.status).toBe(503);
    expect(res.body.estado).toBe('degradado');
  });

  it('responde 200 en salud cuando todo responde', async () => {
    const res = await request(app()).get('/api/talleres/salud');

    expect(res.status).toBe(200);
    expect(res.body.detalle.postgres).toBe('operativo');
    expect(res.body.detalle.redis).toBe('operativo');
  });
});
