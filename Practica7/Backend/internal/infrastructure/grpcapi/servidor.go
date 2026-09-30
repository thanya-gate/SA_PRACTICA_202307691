// Paquete grpcapi expone los mismos casos de uso por gRPC.
// La comunicacion este-oeste entre servicios es gRPC; REST queda para el
// borde norte-sur que consume el navegador.
package grpcapi

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"github.com/yousac/academix-pass/backend/gen/reservasv1"
	"github.com/yousac/academix-pass/backend/internal/application"
	"github.com/yousac/academix-pass/backend/internal/domain"
)

// Servidor implementa reservasv1.ReservasServiceServer.
type Servidor struct {
	reservasv1.UnimplementedReservasServiceServer

	solicitar *application.SolicitarReserva
	consultar *application.ConsultarEstado
	broker    interface{ Confirmado() bool }
}

func NuevoServidor(
	solicitar *application.SolicitarReserva,
	consultar *application.ConsultarEstado,
	broker interface{ Confirmado() bool },
) *Servidor {
	return &Servidor{solicitar: solicitar, consultar: consultar, broker: broker}
}

func (s *Servidor) Health(
	_ context.Context,
	_ *reservasv1.HealthRequest,
) (*reservasv1.HealthResponse, error) {
	return &reservasv1.HealthResponse{
		Estado:            "ok",
		Version:           "2.0.0",
		DependenciaBroker: "rabbitmq",
		Cola:              "academix.reservas.solicitudes",
		BrokerConfirmado:  s.broker != nil && s.broker.Confirmado(),
	}, nil
}

func (s *Servidor) SolicitarReserva(
	ctx context.Context,
	req *reservasv1.SolicitarReservaRequest,
) (*reservasv1.SolicitarReservaResponse, error) {
	seguimiento, err := s.solicitar.Ejecutar(ctx, domain.SolicitudReserva{
		EventoID:         req.GetEventoId(),
		EstudianteNombre: req.GetEstudianteNombre(),
		EstudianteCorreo: req.GetEstudianteCorreo(),
		Canal:            req.GetCanal(),
	})
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	return &reservasv1.SolicitarReservaResponse{
		TrackingId:     seguimiento.TrackingID,
		Estado:         string(seguimiento.Estado),
		Mensaje:        seguimiento.Mensaje,
		UrlSeguimiento: "/api/reservas/" + seguimiento.TrackingID + "/estado",
	}, nil
}

func (s *Servidor) ConsultarEstado(
	ctx context.Context,
	req *reservasv1.ConsultarEstadoRequest,
) (*reservasv1.ConsultarEstadoResponse, error) {
	estado, err := s.consultar.Ejecutar(ctx, req.GetTrackingId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	respuesta := &reservasv1.ConsultarEstadoResponse{
		TrackingId:  estado.TrackingID,
		ReservaId:   estado.ReservaID,
		Estado:      string(estado.Estado),
		Mensaje:     estado.Mensaje,
		ProcesadoEn: estado.ProcesadoEn,
		Encontrado:  estado.Encontrado,
	}

	if estado.CodigoPase != "" {
		respuesta.Ticket = &eventosv1.TicketPase{
			CodigoValidacion: estado.CodigoPase,
			Firma:            estado.FirmaPase,
			EmitidoEn:        estado.ProcesadoEn,
			Titular:          estado.TitularPase,
			EventoTitulo:     estado.TituloEvento,
		}
	}

	return respuesta, nil
}

func (s *Servidor) MetricasProductor(
	_ context.Context,
	_ *reservasv1.MetricasRequest,
) (*reservasv1.MetricasResponse, error) {
	return &reservasv1.MetricasResponse{}, nil
}
