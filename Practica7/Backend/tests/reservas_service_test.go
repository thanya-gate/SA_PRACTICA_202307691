package tests

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"github.com/yousac/academix-pass/backend/internal/application"
	"github.com/yousac/academix-pass/backend/internal/domain"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/cache"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/messaging"
)

type relojFijo struct{ momento time.Time }

func (r relojFijo) Ahora() time.Time { return r.momento }

type trackingFijo struct{ valor string }

func (t trackingFijo) Nuevo() string { return t.valor }

func nuevaSolicitud(broker *messaging.BrokerEnMemoria) *application.SolicitarReserva {
	return application.NuevoSolicitarReserva(
		broker,
		trackingFijo{valor: "TRK-0001"},
		relojFijo{momento: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)},
	)
}

func TestSolicitarReservaPublicaYDevuelveSeguimiento(t *testing.T) {
	broker := messaging.NuevoBrokerEnMemoria()
	caso := nuevaSolicitud(broker)

	seguimiento, err := caso.Ejecutar(context.Background(), domain.SolicitudReserva{
		EventoID:         "EVT-2026-001",
		EstudianteNombre: "Ana Lopez",
		EstudianteCorreo: "ANA.LOPEZ@USAC.EDU.GT",
		Canal:            "vercel",
	})
	if err != nil {
		t.Fatalf("se esperaba una solicitud valida, se obtuvo error: %v", err)
	}

	if seguimiento.TrackingID != "TRK-0001" {
		t.Errorf("tracking inesperado: %q", seguimiento.TrackingID)
	}
	if seguimiento.Estado != domain.EstadoPendiente {
		t.Errorf("todo lo recien publicado debe quedar PENDIENTE, se obtuvo %q", seguimiento.Estado)
	}

	publicados := broker.Publicados()
	if len(publicados) != 1 {
		t.Fatalf("se esperaba exactamente 1 evento publicado, se obtuvieron %d", len(publicados))
	}

	evento := publicados[0]
	if evento.EstudianteCorreo != "ana.lopez@usac.edu.gt" {
		t.Errorf("el correo debio normalizarse en minusculas: %q", evento.EstudianteCorreo)
	}
	if evento.EventoId != "EVT-2026-001" {
		t.Errorf("evento_id incorrecto: %q", evento.EventoId)
	}
	if evento.Intento != 1 {
		t.Errorf("el primer intento debe ser 1, se obtuvo %d", evento.Intento)
	}
}

func TestSolicitarReservaNormalizaCorreoYTomaCanalPorDefecto(t *testing.T) {
	broker := messaging.NuevoBrokerEnMemoria()
	caso := nuevaSolicitud(broker)

	if _, err := caso.Ejecutar(context.Background(), domain.SolicitudReserva{
		EventoID:         "EVT-2026-001",
		EstudianteNombre: "Ana Lopez",
		EstudianteCorreo: "  ANA@USAC.EDU.GT ",
	}); err != nil {
		t.Fatalf("error inesperado: %v", err)
	}

	evento := broker.Publicados()[0]
	if evento.Canal != "web" {
		t.Errorf("el canal por defecto debe ser web, se obtuvo %q", evento.Canal)
	}
	if evento.EstudianteNombre != "Ana Lopez" {
		t.Errorf("el nombre debio ir recortado, se obtuvo %q", evento.EstudianteNombre)
	}
}

func TestSolicitarReservaRechazaSolicitudesInvalidas(t *testing.T) {
	casos := []struct {
		nombre   string
		entrada  domain.SolicitudReserva
		esperado error
	}{
		{
			nombre:   "sin evento",
			entrada:  domain.SolicitudReserva{EstudianteNombre: "Ana Lopez", EstudianteCorreo: "ana@usac.edu.gt"},
			esperado: domain.ErrCamposInvalidos,
		},
		{
			nombre:   "nombre demasiado corto",
			entrada:  domain.SolicitudReserva{EventoID: "EVT-1", EstudianteNombre: "An", EstudianteCorreo: "ana@usac.edu.gt"},
			esperado: domain.ErrCamposInvalidos,
		},
		{
			nombre:   "correo sin arroba",
			entrada:  domain.SolicitudReserva{EventoID: "EVT-1", EstudianteNombre: "Ana Lopez", EstudianteCorreo: "ana.usac.edu.gt"},
			esperado: domain.ErrCamposInvalidos,
		},
		{
			nombre:   "dominio no permitido",
			entrada:  domain.SolicitudReserva{EventoID: "EVT-1", EstudianteNombre: "Ana Lopez", EstudianteCorreo: "ana@ejemplo.com"},
			esperado: domain.ErrCorreoInvalido,
		},
	}

	for _, tc := range casos {
		t.Run(tc.nombre, func(t *testing.T) {
			broker := messaging.NuevoBrokerEnMemoria()
			caso := nuevaSolicitud(broker)

			_, err := caso.Ejecutar(context.Background(), tc.entrada)
			if !errors.Is(err, tc.esperado) {
				t.Fatalf("se esperaba %v, se obtuvo %v", tc.esperado, err)
			}
			if len(broker.Publicados()) != 0 {
				t.Errorf("una solicitud invalida no debe publicarse en el broker")
			}
		})
	}
}

func TestSolicitarReservaPropagaFalloDelBroker(t *testing.T) {
	broker := messaging.NuevoBrokerEnMemoria()
	broker.ForzarFallo(errors.New("broker caido"))
	caso := nuevaSolicitud(broker)

	_, err := caso.Ejecutar(context.Background(), domain.SolicitudReserva{
		EventoID:         "EVT-2026-001",
		EstudianteNombre: "Ana Lopez",
		EstudianteCorreo: "ana@usac.edu.gt",
	})
	if err == nil {
		t.Fatal("si el broker no confirma, el productor no puede devolver 202")
	}
	if !strings.Contains(err.Error(), "broker caido") {
		t.Errorf("el error deberia conservar la causa, se obtuvo: %v", err)
	}
}

func TestConsultarEstadoDevuelvePendienteCuandoElWorkerNoHaRespondido(t *testing.T) {
	consultar := application.NuevoConsultarEstado(cache.NuevoEstadoCacheEnMemoria())

	estado, err := consultar.Ejecutar(context.Background(), "TRK-0001")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if estado.Encontrado {
		t.Error("no debe marcarse como encontrado si el worker aun no escribio")
	}
	if estado.Estado != domain.EstadoPendiente {
		t.Errorf("el estado por defecto debe ser PENDIENTE, se obtuvo %q", estado.Estado)
	}
}

func TestConsultarEstadoLeeResultadoPublicadoPorElWorker(t *testing.T) {
	cacheEstado := cache.NuevoEstadoCacheEnMemoria()
	consultar := application.NuevoConsultarEstado(cacheEstado)

	resultado := &eventosv1.ResultadoReserva{
		TrackingId:  "TRK-0001",
		ReservaId:   "8f1c2b3a-0000-4000-8000-000000000001",
		EventoId:    "EVT-2026-001",
		Estado:      eventosv1.EstadoReserva_CONFIRMADA,
		Mensaje:     "Reserva confirmada.",
		ProcesadoEn: "2026-10-01T12:00:05Z",
		Ticket: &eventosv1.TicketPase{
			CodigoValidacion: "PASE-ABC123",
			Firma:            "hmac:deadbeef",
			Titular:          "Ana Lopez",
			EventoTitulo:     "Arquitectura de microservicios",
		},
	}

	if err := cacheEstado.GuardarResultado(context.Background(), resultado, 0); err != nil {
		t.Fatalf("no se pudo guardar el resultado: %v", err)
	}

	estado, err := consultar.Ejecutar(context.Background(), "TRK-0001")
	if err != nil {
		t.Fatalf("error inesperado: %v", err)
	}

	if !estado.Encontrado {
		t.Fatal("el resultado existia y debio marcarse como encontrado")
	}
	if estado.Estado != domain.EstadoConfirmada {
		t.Errorf("estado esperado CONFIRMADA, se obtuvo %q", estado.Estado)
	}
	if estado.CodigoPase != "PASE-ABC123" {
		t.Errorf("no se proyecto el codigo del pase: %q", estado.CodigoPase)
	}
	if estado.FirmaPase != "hmac:deadbeef" {
		t.Errorf("no se proyecto la firma del pase: %q", estado.FirmaPase)
	}
}

func TestConsultarEstadoRechazaSeguimientoVacio(t *testing.T) {
	consultar := application.NuevoConsultarEstado(cache.NuevoEstadoCacheEnMemoria())

	if _, err := consultar.Ejecutar(context.Background(), "   "); !errors.Is(err, domain.ErrSeguimientoVacio) {
		t.Fatalf("se esperaba ErrSeguimientoVacio, se obtuvo %v", err)
	}
}
