package cache

import (
	"context"
	"sync"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"google.golang.org/protobuf/proto"
)

// EstadoCacheEnMemoria es el doble de prueba de ports.EstadoCache.
type EstadoCacheEnMemoria struct {
	mu        sync.Mutex
	elementos map[string][]byte
}

func NuevoEstadoCacheEnMemoria() *EstadoCacheEnMemoria {
	return &EstadoCacheEnMemoria{elementos: map[string][]byte{}}
}

func (c *EstadoCacheEnMemoria) GuardarResultado(
	_ context.Context,
	resultado *eventosv1.ResultadoReserva,
	_ int,
) error {
	payload, err := proto.Marshal(resultado)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.elementos[resultado.TrackingId] = payload
	return nil
}

func (c *EstadoCacheEnMemoria) ObtenerResultado(
	_ context.Context,
	trackingID string,
) (*eventosv1.ResultadoReserva, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	raw, ok := c.elementos[trackingID]
	if !ok {
		return nil, false
	}
	resultado := &eventosv1.ResultadoReserva{}
	if err := proto.Unmarshal(raw, resultado); err != nil {
		return nil, false
	}
	return resultado, true
}

func (c *EstadoCacheEnMemoria) Ping(context.Context) error { return nil }

func (c *EstadoCacheEnMemoria) Cerrar() error { return nil }
