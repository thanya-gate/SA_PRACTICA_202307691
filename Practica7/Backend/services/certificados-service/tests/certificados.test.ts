/**
 * Pruebas del Servicio de Certificados.
 *
 * El caso mas importante es `coincide con la firma que genera el worker`:
 * ambos servicios estan escritos en lenguajes distintos y calculan la firma
 * por separado. El valor esperado se genero ejecutando el algoritmo del
 * worker en Python, asi que si alguien cambia una de las dos implementaciones
 * la prueba falla.
 */

import { ServicioDeCertificados } from '../src/application/services/servicio-de-certificados';
import { CredencialesEnMemoria } from '../src/infrastructure/persistence/postgres/credenciales-en-memoria';
import { crearAplicacionHttp } from '../src/interfaces/http/app';
import {
  EstadoCredencial,
  codigoTieneFormatoValido,
  evaluarCredencial,
  firmarPase,
  verificarFirma,
} from '../src/domain/credencial';
import request from 'supertest';

const CLAVE = 'clave-de-prueba-practica';
const RESERVA = '33333333-3333-4333-8333-333333333333';

/** Generado por el worker Python con la misma clave y la misma entrada. */
const FIRMA_GENERADA_POR_PYTHON = 'd5a7b708e1ba07b1812274cc8b772245';

function armar() {
  const repositorio = new CredencialesEnMemoria();
  const servicio = new ServicioDeCertificados(repositorio, CLAVE);
  return { repositorio, servicio };
}

describe('firma de pases', () => {
  it('produce el mismo HMAC que el worker en Python', () => {
    expect(firmarPase('CERT-2026-000123', 'EVT-2026-001', CLAVE)).toBe(FIRMA_GENERADA_POR_PYTHON);
  });

  it('firma es determinista y depende de codigo y evento', () => {
    const a = firmarPase('CERT-2026-000123', 'EVT-2026-001', CLAVE);
    const b = firmarPase('CERT-2026-000123', 'EVT-2026-001', CLAVE);
    const c = firmarPase('CERT-2026-000123', 'EVT-2026-002', CLAVE);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('verificarFirma rechaza una firma alterada', () => {
    expect(verificarFirma('CERT-2026-000123', 'EVT-2026-001', CLAVE, FIRMA_GENERADA_POR_PYTHON)).toBe(true);
    expect(verificarFirma('CERT-2026-000123', 'EVT-2026-001', CLAVE, 'a'.repeat(32))).toBe(false);
  });

  it('verificarFirma no lanza excepcion si la firma tiene otra longitud', () => {
    expect(verificarFirma('CERT-2026-000123', 'EVT-2026-001', CLAVE, 'corta')).toBe(false);
    expect(verificarFirma('CERT-2026-000123', 'EVT-2026-001', CLAVE, '')).toBe(false);
  });

  it('rechaza codigos con formato invalido', () => {
    expect(codigoTieneFormatoValido('CERT-2026-000123')).toBe(true);
    expect(codigoTieneFormatoValido('cert-2026-000123')).toBe(true);
    expect(codigoTieneFormatoValido('ABC-123')).toBe(false);
    expect(codigoTieneFormatoValido('')).toBe(false);
  });
});

describe('evaluarCredencial', () => {
  const credencial = {
    codigo: 'CERT-2026-000123',
    titulo: 'Asistencia: Go avanzado',
    titular: 'Ana Lopez',
    eventoId: 'EVT-2026-001',
    firma: FIRMA_GENERADA_POR_PYTHON,
    emitidoEn: '2026-10-05T15:00:00.000Z',
    revocada: false,
    verificaciones: 0,
  };

  it('devuelve NO_ENCONTRADA si la credencial no existe', () => {
    const resultado = evaluarCredencial(null, 'CERT-2026-000999', false, CLAVE);

    expect(resultado.estado).toBe(EstadoCredencial.NO_ENCONTRADA);
    expect(resultado.mensaje).toContain('No se encontro');
  });

  it('acepta la credencial cuando la firma coincide y se exige firma', () => {
    const resultado = evaluarCredencial(credencial, credencial.codigo, true, CLAVE);

    expect(resultado.estado).toBe(EstadoCredencial.VALIDA);
    expect(resultado.titular).toBe('Ana Lopez');
  });

  it('rechaza la credencial si se exige firma y esta no coincide', () => {
    const resultado = evaluarCredencial({ ...credencial, firma: 'f'.repeat(32) }, credencial.codigo, true, CLAVE);

    expect(resultado.estado).toBe(EstadoCredencial.INVALIDA);
  });

  it('no comprueba la firma si el llamador no la exige', () => {
    const resultado = evaluarCredencial({ ...credencial, firma: 'demo' }, credencial.codigo, false, CLAVE);

    expect(resultado.estado).toBe(EstadoCredencial.VALIDA);
  });

  it('una credencial revocada es invalida aunque la firma sea correcta', () => {
    const resultado = evaluarCredencial({ ...credencial, revocada: true }, credencial.codigo, true, CLAVE);

    expect(resultado.estado).toBe(EstadoCredencial.INVALIDA);
    expect(resultado.mensaje).toContain('revocada');
  });
});

describe('ServicioDeCertificados', () => {
  it('CU-P7-04 verifica una credencial emitida', async () => {
    const { repositorio, servicio } = armar();
    await servicio.registrarEmision({
      codigo: 'CERT-2026-000123',
      titulo: 'Asistencia: Go avanzado',
      titular: 'Ana Lopez',
      eventoId: 'EVT-2026-001',
      firma: firmarPase('CERT-2026-000123', 'EVT-2026-001', CLAVE),
      emitidoEn: '2026-10-05T15:00:00.000Z',
      reservaId: RESERVA,
    });

    const resultado = await servicio.verificar('CERT-2026-000123', true);

    expect(resultado.estado).toBe(EstadoCredencial.VALIDA);
    expect(repositorio.credenciales.size).toBe(1);
  });

  it('normaliza el codigo a mayusculas', async () => {
    const { repositorio, servicio } = armar();
    repositorio.sembrar([{ codigo: 'CERT-2026-000742', firma: FIRMA_GENERADA_POR_PYTHON }]);

    const resultado = await servicio.verificar('  cert-2026-000742 ', false);

    expect(resultado.estado).not.toBe(EstadoCredencial.NO_ENCONTRADA);
  });

  it('informa NO_ENCONTRADA sin lanzar excepcion', async () => {
    const { servicio } = armar();

    const resultado = await servicio.verificar('CERT-2026-000000', false);

    expect(resultado.estado).toBe(EstadoCredencial.NO_ENCONTRADA);
  });

  it('deja auditoria de toda verificacion, incluso fallida', async () => {
    const { repositorio, servicio } = armar();

    await servicio.verificar('CERT-2026-000000', false);
    await servicio.verificar('CERT-2026-111111', false);

    expect(repositorio.auditoria).toHaveLength(2);
    expect(repositorio.auditoria[0]?.resultado).toBe('NO_ENCONTRADA');
  });

  it('CU-P8-05 registra la emision del worker', async () => {
    const { servicio } = armar();

    const resultado = await servicio.registrarEmision({
      codigo: 'CERT-2026-000321',
      titulo: 'Asistencia: Kafka',
      titular: 'Luis Perez',
      eventoId: 'EVT-2026-002',
      firma: 'firma',
      emitidoEn: '2026-10-06T15:00:00.000Z',
      reservaId: RESERVA,
    });

    expect(resultado).toEqual({ registrada: true, yaExistia: false });
  });

  it('el registro es idempotente: redelivery no duplica la fila', async () => {
    const { repositorio, servicio } = armar();
    const emision = {
      codigo: 'CERT-2026-000321',
      titulo: 'Asistencia: Kafka',
      titular: 'Luis Perez',
      eventoId: 'EVT-2026-002',
      firma: 'firma',
      emitidoEn: '2026-10-06T15:00:00.000Z',
      reservaId: RESERVA,
    };

    await servicio.registrarEmision(emision);
    const segunda = await servicio.registrarEmision(emision);

    expect(segunda.yaExistia).toBe(true);
    expect(repositorio.credenciales.size).toBe(1);
  });

  it('rechaza registrar una emision sin titular', async () => {
    const { servicio } = armar();

    const resultado = await servicio.registrarEmision({
      codigo: 'CERT-2026-000321',
      titulo: 'Asistencia',
      titular: '   ',
      eventoId: 'EVT-1',
      firma: 'firma',
      emitidoEn: '2026-10-06T15:00:00.000Z',
      reservaId: RESERVA,
    });

    expect(resultado.registrada).toBe(false);
  });

  it('responde NO_ENCONTRADA si se pide el codigo vacio', async () => {
    const { servicio } = armar();

    const resultado = await servicio.verificar('   ', false);

    expect(resultado.estado).toBe(EstadoCredencial.NO_ENCONTRADA);
    expect(resultado.mensaje).toContain('Debe indicar');
  });
});

describe('API HTTP de credenciales', () => {
  function app(origenesPermitidos: string[] = ['https://academix.vercel.app']) {
    const { servicio, repositorio } = armar();
    return crearAplicacionHttp(servicio, {
      version: '2.0.0',
      origenesPermitidos,
      postgres: repositorio,
    });
  }

  it('devuelve Access-Control-Allow-Origin al origen permitido', async () => {
    const res = await request(app())
      .get('/api/certificados/verificar')
      .query({ codigo: 'CERT-2026-000000' })
      .set('Origin', 'https://academix.vercel.app');

    expect(res.headers['access-control-allow-origin']).toBe('https://academix.vercel.app');
  });

  it('omite Access-Control-Allow-Origin para un origen desconocido', async () => {
    const res = await request(app())
      .get('/api/certificados/verificar')
      .query({ codigo: 'CERT-2026-000000' })
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
      const res = await request(api)
        .get('/api/certificados/verificar')
        .query({ codigo: 'CERT-2026-000000' })
        .set('Origin', origen);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });

  it('GET /api/certificados/verificar responde 200 con estado NO_ENCONTRADA', async () => {
    const res = await request(app()).get('/api/certificados/verificar').query({ codigo: 'CERT-2026-000000' });

    expect(res.status).toBe(200);
    expect(res.body.estadoTexto).toBe('NO_ENCONTRADA');
  });

  it('no expone el registro de emisiones por HTTP: solo por gRPC', async () => {
    // El worker es el unico autorizado a registrar. Publicar una ruta HTTP
    // permitiria que cualquiera fabricara un pase valido.
    const res = await request(app()).post('/api/certificados/registrar').send({ codigo: 'CERT-2026-000999' });

    expect(res.status).toBe(404);
  });

  it('expone el estado como enum numerico del proto', async () => {
    const { servicio, repositorio } = armar();
    repositorio.sembrar([{ codigo: 'CERT-2026-000742', firma: FIRMA_GENERADA_POR_PYTHON }]);
    const api = crearAplicacionHttp(servicio, {
      version: '2.0.0',
      origenesPermitidos: ['*'],
      postgres: repositorio,
    });

    const res = await request(api).get('/api/certificados/verificar').query({ codigo: 'CERT-2026-000742' });

    expect(res.body.estado).toBe(1);
  });

  it('responde 503 en salud cuando PostgreSQL no responde', async () => {
    const { servicio } = armar();
    const api = crearAplicacionHttp(servicio, {
      version: '2.0.0',
      origenesPermitidos: ['*'],
      postgres: { ping: async () => { throw new Error('sin conexion'); } },
    });

    const res = await request(api).get('/api/certificados/salud');

    expect(res.status).toBe(503);
    expect(res.body.estado).toBe('degradado');
  });
});
