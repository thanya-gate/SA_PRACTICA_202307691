/**
 * Casos de uso del Servicio de Catalogo de Talleres.
 *
 * CU-P7-01: consultar el catalogo de eventos.
 * CU-P7-02: consultar el detalle y la disponibilidad de un evento.
 * CU-P8-03: reclamar un cupo mediante transaccion atomica (lo invoca el
 *            worker por gRPC, no el navegador).
 */

import {
  type CacheCatalogo,
  type CatalogoRepositorio,
  type ConsultaEventos,
} from '../ports/catalogo';
import {
  type ClaimDeCupo,
  type EventoDetalle,
  type ResultadoListado,
  type EstadoEvento,
  ResultadoCupo,
  admiteReserva,
  mensajeSegunResultado,
} from '../../domain/evento';

const LIMITE_MAXIMO = 100;

function claveListado(consulta: ConsultaEventos): string {
  const busqueda = consulta.busqueda.trim().toLowerCase();
  return [
    'listado',
    busqueda || 'todos',
    consulta.limite,
    consulta.offset,
    consulta.soloConCupo ? 'con-cupo' : 'todos-los-cupos',
  ].join(':');
}

export class CatalogoDeTalleres {
  constructor(
    private readonly repositorio: CatalogoRepositorio,
    private readonly cache: CacheCatalogo,
    private readonly ttlListado = 15,
    private readonly ttlDetalle = 30,
  ) {}

  async listarEventos(entrada: ConsultaEventos): Promise<ResultadoListado> {
    const consulta: ConsultaEventos = {
      busqueda: entrada.busqueda ?? '',
      limite: Math.min(Math.max(entrada.limite || 20, 1), LIMITE_MAXIMO),
      offset: Math.max(entrada.offset || 0, 0),
      soloConCupo: Boolean(entrada.soloConCupo),
    };

    const clave = claveListado(consulta);
    const enCache = await this.cache.obtenerListado(clave);
    if (enCache) {
      return { ...enCache, origenCache: true };
    }

    const resultado = await this.repositorio.listar(consulta);
    await this.cache.guardarListado(clave, resultado, this.ttlListado);
    return resultado;
  }

  async obtenerEvento(eventoId: string): Promise<{ evento: EventoDetalle | null; origenCache: boolean }> {
    const normalizado = eventoId.trim();
    if (!normalizado) {
      return { evento: null, origenCache: false };
    }

    const enCache = await this.cache.obtenerDetalle(normalizado);
    if (enCache) {
      return { evento: enCache, origenCache: true };
    }

    const evento = await this.repositorio.obtener(normalizado);
    if (evento) {
      await this.cache.guardarDetalle(normalizado, evento, this.ttlDetalle);
    }
    return { evento, origenCache: false };
  }

  async validarEvento(eventoId: string): Promise<{ existe: boolean; admite: boolean; titulo: string; estado: EstadoEvento | ''; motivo: string }> {
    const validacion = await this.repositorio.validar(eventoId.trim());
    if (!validacion.existe) {
      return { existe: false, admite: false, titulo: '', estado: '', motivo: 'El evento solicitado no existe.' };
    }
    return {
      existe: true,
      admite: validacion.admite,
      titulo: validacion.titulo,
      estado: validacion.estado as EstadoEvento,
      motivo: validacion.admite ? '' : 'El evento no admite reservas.',
    };
  }

  async consultarDisponibilidad(eventoId: string) {
    return this.repositorio.consultarDisponibilidad(eventoId.trim());
  }

  /**
   * Reclama un cupo. Es la unica via por la que baja el contador, y se
   * ejecuta siempre dentro de la funcion fn_reclamar_cupo, que abre la
   * transaccion y bloquea la fila del evento.
   */
  async reclamarCupo(eventoId: string, reservaId: string, trackingId: string): Promise<ClaimDeCupo> {
    if (!eventoId.trim() || !reservaId.trim()) {
      return {
        resultado: ResultadoCupo.EVENTO_INEXISTENTE,
        cuposDisponibles: 0,
        cuposTotales: 0,
        titulo: '',
        mensaje: mensajeSegunResultado(ResultadoCupo.EVENTO_INEXISTENTE),
      };
    }

    const claim = await this.repositorio.reclamarCupo(eventoId.trim(), reservaId, trackingId.trim());

    // El contador cambio: la cache del detalle quedaria mostrando un cupo
    // que ya no existe, asi que se invalida siempre.
    await this.cache.invalidarEvento(eventoId.trim());

    return { ...claim, mensaje: claim.mensaje || mensajeSegunResultado(claim.resultado) };
  }

  async liberarCupo(eventoId: string, reservaId: string): Promise<{ liberado: boolean; cuposDisponibles: number }> {
    const disponibles = await this.repositorio.liberarCupo(eventoId.trim(), reservaId.trim());
    await this.cache.invalidarEvento(eventoId.trim());
    return { liberado: disponibles > 0, cuposDisponibles: disponibles };
  }

  async invalidarCache(eventoId: string): Promise<boolean> {
    return this.cache.invalidarEvento(eventoId.trim());
  }

  async resumen() {
    return { eventos: await this.repositorio.contarEventos() };
  }
}

export { admiteReserva };
