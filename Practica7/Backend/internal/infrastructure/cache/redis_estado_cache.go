// Paquete cache contiene los adaptadores de Redis y su doble en memoria.
package cache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"google.golang.org/protobuf/proto"

	"github.com/redis/go-redis/v9"
)

const prefijoSeguimiento = "academix:seguimiento:"

// RedisEstadoCache implementa ports.EstadoCache.
//
// El worker escribe aqui el resultado final de cada reserva; el productor
// lo lee para responder las consultas de seguimiento sin tocar Postgres.
// Redis es cache, no fuente de verdad: si se pierde, el worker vuelve a
// escribir y el cliente simplemente observa PENDIENTE durante un instante.
type RedisEstadoCache struct {
	cliente *redis.Client
	ttl     time.Duration
}

func NuevoRedisEstadoCache(url string, ttl time.Duration) *RedisEstadoCache {
	return &RedisEstadoCache{
		cliente: redis.NewClient(&redis.Options{Addr: url}),
		ttl:     ttl,
	}
}

func (c *RedisEstadoCache) GuardarResultado(
	ctx context.Context,
	resultado *eventosv1.ResultadoReserva,
	ttlSeconds int,
) error {
	payload, err := proto.Marshal(resultado)
	if err != nil {
		return fmt.Errorf("no se pudo serializar el resultado: %w", err)
	}

	ttl := c.ttl
	if ttlSeconds > 0 {
		ttl = time.Duration(ttlSeconds) * time.Second
	}

	return c.cliente.Set(
		ctx, prefijoSeguimiento+resultado.TrackingId, payload, ttl,
	).Err()
}

func (c *RedisEstadoCache) ObtenerResultado(
	ctx context.Context,
	trackingID string,
) (*eventosv1.ResultadoReserva, bool) {
	raw, err := c.cliente.Get(ctx, prefijoSeguimiento+trackingID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, false
		}
		return nil, false
	}

	resultado := &eventosv1.ResultadoReserva{}
	if err := proto.Unmarshal(raw, resultado); err != nil {
		return nil, false
	}
	return resultado, true
}

func (c *RedisEstadoCache) Ping(ctx context.Context) error {
	return c.cliente.Ping(ctx).Err()
}

func (c *RedisEstadoCache) Cerrar() error { return c.cliente.Close() }
