package messaging

import (
	"context"
	"errors"
	"sync"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
)

// ErrPublicacionFallida envuelve los errores de publicacion para que la
// capa de interfaces los distinga de un error de validacion.
var ErrPublicacionFallida = errors.New("no se pudo publicar la solicitud en el broker")

// BrokerEnMemoria es el doble de prueba de ports.Broker. Permite ejecutar
// las pruebas unitarias sin levantar RabbitMQ, comprobando el contrato de
// publicacion del productor de forma determinista.
type BrokerEnMemoria struct {
	mu        sync.Mutex
	mensajes  []*eventosv1.SolicitudReserva
	fallarEn  bool
	fallarCon error
}

func NuevoBrokerEnMemoria() *BrokerEnMemoria {
	return &BrokerEnMemoria{}
}

// ForzarFallo hace que las siguientes publicaciones devuelvan error.
func (b *BrokerEnMemoria) ForzarFallo(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fallarCon = err
	b.fallarEn = true
}

func (b *BrokerEnMemoria) PublicarSolicitud(
	_ context.Context,
	evento *eventosv1.SolicitudReserva,
) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.fallarEn {
		return b.fallarCon
	}
	b.mensajes = append(b.mensajes, evento)
	return nil
}

func (b *BrokerEnMemoria) Confirmado() bool { return true }

func (b *BrokerEnMemoria) Cerrar() error { return nil }

func (b *BrokerEnMemoria) Publicados() []*eventosv1.SolicitudReserva {
	b.mu.Lock()
	defer b.mu.Unlock()
	copia := make([]*eventosv1.SolicitudReserva, len(b.mensajes))
	copy(copia, b.mensajes)
	return copia
}
