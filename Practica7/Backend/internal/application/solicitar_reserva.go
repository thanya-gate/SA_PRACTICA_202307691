// Paquete application orquesta los casos de uso del productor.
// Cada archivo corresponde a un caso de uso con una sola razon para cambiar
// (Principio de Responsabilidad Unica).
package application

import (
	"context"
	"time"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"github.com/yousac/academix-pass/backend/internal/application/ports"
	"github.com/yousac/academix-pass/backend/internal/domain"

	"github.com/google/uuid"
)

// Reloj abstracts la hora para que las pruebas sean deterministas.
type Reloj interface {
	Ahora() time.Time
}

type relojSistema struct{}

func (relojSistema) Ahora() time.Time { return time.Now().UTC() }

func NuevoRelojSistema() Reloj { return relojSistema{} }

type generadorUUID struct{}

func (generadorUUID) Nuevo() string { return uuid.NewString() }

func NuevoGeneradorTracking() ports.GeneradorTracking { return generadorUUID{} }

// Caso de uso CU-P7-03 / CU-P8-01: Solicitar reserva de cupo.
//
// El productor no abre ninguna conexion a la base de datos. Su unico
// trabajo es normalizar la entrada, generar el identificador de seguimiento,
// publicar el evento con confirmacion y devolver 202 Accepted.
type SolicitarReserva struct {
	broker   ports.Broker
	tracking ports.GeneradorTracking
	reloj    Reloj
}

func NuevoSolicitarReserva(
	broker ports.Broker,
	tracking ports.GeneradorTracking,
	reloj Reloj,
) *SolicitarReserva {
	return &SolicitarReserva{broker: broker, tracking: tracking, reloj: reloj}
}

func (s *SolicitarReserva) Ejecutar(
	ctx context.Context,
	entrada domain.SolicitudReserva,
) (domain.Seguimiento, error) {
	normalizada, err := entrada.Normalizar()
	if err != nil {
		return domain.Seguimiento{}, err
	}

	seguimiento := domain.Seguimiento{
		TrackingID:  s.tracking.Nuevo(),
		Estado:      domain.EstadoPendiente,
		Mensaje:     "La solicitud fue recibida y esta en cola de procesamiento.",
		PublicadoEn: s.reloj.Ahora().Format(time.RFC3339Nano),
		Intento:     1,
	}

	evento := &eventosv1.SolicitudReserva{
		TrackingId:       seguimiento.TrackingID,
		EventoId:         normalizada.EventoID,
		EstudianteNombre: normalizada.EstudianteNombre,
		EstudianteCorreo: normalizada.EstudianteCorreo,
		Canal:            normalizada.Canal,
		PublicadoEn:      seguimiento.PublicadoEn,
		Intento:          int32(seguimiento.Intento),
	}

	if err := s.broker.PublicarSolicitud(ctx, evento); err != nil {
		return domain.Seguimiento{}, err
	}

	return seguimiento, nil
}
