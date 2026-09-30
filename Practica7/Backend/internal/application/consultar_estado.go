package application

import (
	"context"
	"strings"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"github.com/yousac/academix-pass/backend/internal/application/ports"
	"github.com/yousac/academix-pass/backend/internal/domain"
)

// Caso de uso CU-P7-04 / CU-P8-02: Consultar el estado de una reserva.
//
// La lectura se resuelve desde la cache de seguimiento que el worker
// actualiza al resolver la solicitud. Si aun no hay resultado, se responde
// PENDIENTE: el cliente puede repetir la consulta sin que el productor
// tenga que esperar por el procesamiento.
type ConsultarEstado struct {
	cache ports.EstadoCache
}

func NuevoConsultarEstado(cache ports.EstadoCache) *ConsultarEstado {
	return &ConsultarEstado{cache: cache}
}

func (c *ConsultarEstado) Ejecutar(
	ctx context.Context,
	trackingID string,
) (domain.EstadoConsultado, error) {
	normalizado := strings.TrimSpace(trackingID)
	if normalizado == "" {
		return domain.EstadoConsultado{}, domain.ErrSeguimientoVacio
	}

	estado := domain.EstadoConsultado{
		TrackingID: normalizado,
		Estado:     domain.EstadoPendiente,
		Mensaje:    "La solicitud aun no ha sido resuelta por el worker. Intente de nuevo en unos segundos.",
	}

	resultado, ok := c.cache.ObtenerResultado(ctx, normalizado)
	if !ok {
		return estado, nil
	}

	estado.Encontrado = true
	estado.ReservaID = resultado.ReservaId
	estado.Mensaje = resultado.Mensaje
	estado.ProcesadoEn = resultado.ProcesadoEn
	estado.Estado = estadoDesdeProto(resultado.Estado)

	if t := resultado.GetTicket(); t != nil {
		estado.CodigoPase = t.CodigoValidacion
		estado.FirmaPase = t.Firma
		estado.TitularPase = t.Titular
		estado.TituloEvento = t.EventoTitulo
	}

	return estado, nil
}

// estadoDesdeProto traduce la enumeracion del contrato al vocabulario del
// dominio. El valor NO_ESPECIFICADO se trata como PENDIENTE porque un
// resultado sin estado nunca deberia llegar a la cache.
func estadoDesdeProto(e eventosv1.EstadoReserva) domain.EstadoReserva {
	switch e {
	case eventosv1.EstadoReserva_CONFIRMADA:
		return domain.EstadoConfirmada
	case eventosv1.EstadoReserva_RECHAZADA:
		return domain.EstadoRechazada
	case eventosv1.EstadoReserva_SIN_CUPO:
		return domain.EstadoSinCupo
	default:
		return domain.EstadoPendiente
	}
}
