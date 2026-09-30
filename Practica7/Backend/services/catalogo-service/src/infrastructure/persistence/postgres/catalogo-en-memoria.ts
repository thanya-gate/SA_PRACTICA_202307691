/**
 * Repositorio del catalogo en memoria.
 *
 * Doble de prueba de CatalogoRepositorio. Reproduce el comportamiento
 * atomico de fn_reclamar_cupo: solo descuenta si quedan cupos.
 */

import type { CatalogoRepositorio, ConsultaEventos } from '../../../application/ports/catalogo';
import {
  type ClaimDeCupo,
  type EventoDetalle,
  type EstadoEvento,
  type ResultadoListado,
  ResultadoCupo,
  admiteReserva,
} from '../../../domain/evento';

interface EventoSembrado {
  eventoId: string;
  titulo: string;
  curso: string;
  ponente: string;
  correoPonente: string;
  fecha: string;
  modalidad: string;
  descripcion: string;
  prerrequisitos: string[];
  cuposTotales: number;
  cuposDisponibles: number;
  estado: EstadoEvento;
}

export class CatalogoEnMemoria implements CatalogoRepositorio {
  readonly eventos = new Map<string, EventoSembrado>();
  readonly cuposOcupados = new Set<string>();
  llamadasListar = 0;
  llamadasReclamar = 0;

  sembrar(eventos: Partial<EventoSembrado>[]): void {
    for (const parcial of eventos) {
      const evento: EventoSembrado = {
        eventoId: 'EVT-1',
        titulo: 'Taller de prueba',
        curso: 'Software Avanzado',
        ponente: 'Docente',
        correoPonente: 'docente@usac.edu.gt',
        fecha: '2026-10-05T15:00:00.000Z',
        modalidad: 'Virtual',
        descripcion: '',
        prerrequisitos: [],
        cuposTotales: 10,
        cuposDisponibles: 10,
        estado: 'PROGRAMADO',
        ...parcial,
      };
      this.eventos.set(evento.eventoId, evento);
    }
  }

  async listar(consulta: ConsultaEventos): Promise<ResultadoListado> {
    this.llamadasListar += 1;
    const busqueda = consulta.busqueda.trim().toLowerCase();
    const filtrados = [...this.eventos.values()].filter((evento) => {
      if (evento.estado === 'CANCELADO') return false;
      if (consulta.soloConCupo && evento.cuposDisponibles <= 0) return false;
      if (!busqueda) return true;
      return [evento.titulo, evento.curso, evento.ponente].some((campo) =>
        campo.toLowerCase().includes(busqueda),
      );
    });

    return {
      eventos: filtrados.slice(consulta.offset, consulta.offset + consulta.limite).map((e) => ({
        eventoId: e.eventoId,
        titulo: e.titulo,
        curso: e.curso,
        ponente: e.ponente,
        fecha: e.fecha,
        modalidad: e.modalidad,
        cuposDisponibles: e.cuposDisponibles,
        cuposTotales: e.cuposTotales,
        estado: e.estado,
      })),
      total: filtrados.length,
      origenCache: false,
    };
  }

  async obtener(eventoId: string): Promise<EventoDetalle | null> {
    const evento = this.eventos.get(eventoId);
    if (!evento) return null;
    return {
      eventoId: evento.eventoId,
      titulo: evento.titulo,
      curso: evento.curso,
      ponente: evento.ponente,
      correoPonente: evento.correoPonente,
      fecha: evento.fecha,
      modalidad: evento.modalidad,
      descripcion: evento.descripcion,
      prerrequisitos: evento.prerrequisitos,
      cuposDisponibles: evento.cuposDisponibles,
      cuposTotales: evento.cuposTotales,
      estado: evento.estado,
    };
  }

  async validar(eventoId: string) {
    const evento = this.eventos.get(eventoId);
    if (!evento) return { existe: false, admite: false, estado: '', titulo: '' };
    return {
      existe: true,
      admite: admiteReserva(evento.estado),
      estado: evento.estado,
      titulo: evento.titulo,
    };
  }

  async consultarDisponibilidad(eventoId: string) {
    const evento = this.eventos.get(eventoId);
    if (!evento) return { disponibles: 0, totales: 0, admite: false };
    return {
      disponibles: evento.cuposDisponibles,
      totales: evento.cuposTotales,
      admite: admiteReserva(evento.estado),
    };
  }

  async reclamarCupo(eventoId: string, reservaId: string): Promise<ClaimDeCupo> {
    this.llamadasReclamar += 1;
    const evento = this.eventos.get(eventoId);
    if (!evento) {
      return {
        resultado: ResultadoCupo.EVENTO_INEXISTENTE,
        cuposDisponibles: 0,
        cuposTotales: 0,
        titulo: '',
        mensaje: '',
      };
    }
    if (!admiteReserva(evento.estado)) {
      return {
        resultado: ResultadoCupo.EVENTO_CERRADO,
        cuposDisponibles: evento.cuposDisponibles,
        cuposTotales: evento.cuposTotales,
        titulo: evento.titulo,
        mensaje: '',
      };
    }
    if (evento.cuposDisponibles <= 0) {
      return {
        resultado: ResultadoCupo.SIN_CUPO,
        cuposDisponibles: 0,
        cuposTotales: evento.cuposTotales,
        titulo: evento.titulo,
        mensaje: '',
      };
    }
    if (this.cuposOcupados.has(reservaId)) {
      return {
        resultado: ResultadoCupo.YA_OCUPADO,
        cuposDisponibles: evento.cuposDisponibles,
        cuposTotales: evento.cuposTotales,
        titulo: evento.titulo,
        mensaje: '',
      };
    }

    evento.cuposDisponibles -= 1;
    this.cuposOcupados.add(reservaId);
    return {
      resultado: ResultadoCupo.ASIGNADO,
      cuposDisponibles: evento.cuposDisponibles,
      cuposTotales: evento.cuposTotales,
      titulo: evento.titulo,
      mensaje: '',
    };
  }

  async liberarCupo(eventoId: string, reservaId: string): Promise<number> {
    const evento = this.eventos.get(eventoId);
    if (!evento || !this.cuposOcupados.delete(reservaId)) return 0;
    evento.cuposDisponibles = Math.min(evento.cuposTotales, evento.cuposDisponibles + 1);
    return evento.cuposDisponibles;
  }

  async contarEventos(): Promise<number> {
    return [...this.eventos.values()].filter((e) => e.estado !== 'CANCELADO').length;
  }

  async ping(): Promise<void> {
    /* sin dependencias externas */
  }
}
