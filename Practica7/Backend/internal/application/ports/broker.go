// Paquete ports define las interfaces que la capa de aplicacion necesita.
// Son el contrato de inversion de dependencias: la aplicacion depende de
// estas abstracciones y los adaptadores de infraestructura las implementan.
package ports

import (
	"context"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
)

// Broker publica el evento de dominio en el bus de mensajeria.
// Implementaciones: messaging.RabbitMQBroker (produccion) y
// messaging.BrokerEnMemoria (pruebas).
type Broker interface {
	// PublicarSolicitud entrega el evento con confirmacion del broker.
	// Devolver nil significa que el broker acepto y persistio el mensaje.
	PublicarSolicitud(ctx context.Context, evento *eventosv1.SolicitudReserva) error
	// Confirmado indica si el canal tiene confirmaciones de entrega activas.
	Confirmado() bool
	// Cerrar libera la conexion.
	Cerrar() error
}

// EstadoCache guarda el resultado final del procesamiento para que el
// servicio productor pueda responder consultas de seguimiento sin tocar la
// base de datos, manteniendo al productor sin estado.
type EstadoCache interface {
	GuardarResultado(ctx context.Context, resultado *eventosv1.ResultadoReserva, ttlSeconds int) error
	ObtenerResultado(ctx context.Context, trackingID string) (*eventosv1.ResultadoReserva, bool)
	Ping(ctx context.Context) error
	Cerrar() error
}

// GeneradorTracking abstracts la creacion de identificadores para que las
// pruebas puedan fijar el valor y comprobar el determinismo.
type GeneradorTracking interface {
	Nuevo() string
}
