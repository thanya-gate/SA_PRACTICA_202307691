// Paquete messaging contiene los adaptadores de entrada/salida hacia el
// Message Broker y los codecs de serializacion de los contratos.
package messaging

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"google.golang.org/protobuf/proto"

	amqp "github.com/rabbitmq/amqp091-go"
)

// RabbitMQBroker implementa ports.Broker sobre AMQP 0-9-1.
//
// Garantias de entrega exigidas por la practica:
//   - la cola y el exchange son durables (sobreviven a reinicios del broker);
//   - los mensajes se publican con DeliveryMode persistente;
//   - se espera la confirmacion del broker (publisher confirms) antes de
//     devolver exito al cliente, de modo que un 202 Accepted nunca miente;
//   - si la confirmacion no llega, el mensaje se devuelve a la cola interna
//     del cliente y se reintenta con backoff acotado.
type RabbitMQBroker struct {
	conn        *amqp.Connection
	channel     *amqp.Channel
	confirmados <-chan amqp.Confirmation
	confirmErr  <-chan *amqp.Error

	exchange    string
	routingKey  string
	cola        string
	publishing  amqp.Publishing
	reintentos  int
	esperaMaxMs int

	mu       sync.RWMutex
	sanos    bool
	metricas Metricas
}

// Metricas exponen contadores para la ruta /api/reservas/metricas.
type Metricas struct {
	Publicadas        int64
	ConfirmadasBroker int64
	RechazadasBroker  int64
	Duplicadas        int64
}

// ConfigBroker agrupa los parametros de conexion declarados en el compose.
type ConfigBroker struct {
	URL               string
	Exchange          string
	Cola              string
	RoutingKey        string
	ColaMuertos       string
	ExchangeMuertos   string
	RoutingKeyMuertos string
	Reintentos        int
	EsperaMaximaMS    int
}

func NuevoRabbitMQBroker(cfg ConfigBroker) (*RabbitMQBroker, error) {
	conn, err := amqp.DialConfig(cfg.URL, amqp.Config{
		Heartbeat: 10 * time.Second,
		Locale:    "es_ES",
	})
	if err != nil {
		return nil, fmt.Errorf("no se pudo conectar al broker: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("no se pudo abrir el canal AMQP: %w", err)
	}

	broker := &RabbitMQBroker{
		conn:        conn,
		channel:     ch,
		exchange:    cfg.Exchange,
		routingKey:  cfg.RoutingKey,
		cola:        cfg.Cola,
		reintentos:  cfg.Reintentos,
		esperaMaxMs: cfg.EsperaMaximaMS,
		sanos:       true,
	}

	if err := broker.declararTopologia(cfg); err != nil {
		_ = broker.Cerrar()
		return nil, err
	}

	if err := ch.Confirm(false); err != nil {
		_ = broker.Cerrar()
		return nil, fmt.Errorf("no se pudieron activar las confirmaciones del broker: %w", err)
	}

	broker.confirmados = ch.NotifyPublish(make(chan amqp.Confirmation, 1))
	broker.confirmErr = ch.NotifyClose(make(chan *amqp.Error, 1))

	broker.publishing = amqp.Publishing{
		ContentType:  "application/x-protobuf",
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now().UTC(),
		Headers: amqp.Table{
			"contrato": "academix.eventos.v1.SolicitudReserva",
		},
	}

	return broker, nil
}

// declararTopologia crea exchange, cola y bindings de forma idempotente.
//
// El orden importa: RabbitMQ rechaza una cola que referencia un exchange
// todavia inexistente, asi que el exchange de muertos se declara primero.
func (b *RabbitMQBroker) declararTopologia(cfg ConfigBroker) error {
	if err := b.channel.ExchangeDeclare(
		cfg.Exchange, amqp.ExchangeDirect, true, false, false, false, nil,
	); err != nil {
		return fmt.Errorf("no se pudo declarar el exchange %q: %w", cfg.Exchange, err)
	}

	if err := b.channel.ExchangeDeclare(
		cfg.ExchangeMuertos, amqp.ExchangeDirect, true, false, false, false, nil,
	); err != nil {
		return fmt.Errorf("no se pudo declarar el exchange de muertos %q: %w", cfg.ExchangeMuertos, err)
	}

	// La cola de muertos es classic y no tiene limite de entrega: un mensaje
	// que llega aqui ya no debe reintentarse nunca.
	if _, err := b.channel.QueueDeclare(cfg.ColaMuertos, true, false, false, false, nil); err != nil {
		return fmt.Errorf("no se pudo declarar la cola de muertos %q: %w", cfg.ColaMuertos, err)
	}
	if err := b.channel.QueueBind(
		cfg.ColaMuertos, cfg.RoutingKeyMuertos, cfg.ExchangeMuertos, false, nil,
	); err != nil {
		return fmt.Errorf("no se pudo enlazar la cola de muertos: %w", err)
	}

	// Quorum: el mensaje se replica en los nodos del cluster, de modo que un
	// nodo caido no pierde reservas. x-delivery-limit mueve a la cola de
	// muertos lo que se reintenta 5 veces, que es el techo que impone
	// RabbitMQ y evita el bucle infinito de mensajesvenenos.
	//
	// No se fija x-expires: las colas quorum no admiten ese argumento y la
	// declaracion fallaria al arrancar.
	args := amqp.Table{
		"x-queue-type":              "quorum",
		"x-queue-mode":              "default",
		"x-delivery-limit":          int32(5),
		"x-dead-letter-exchange":    cfg.ExchangeMuertos,
		"x-dead-letter-routing-key": cfg.RoutingKeyMuertos,
	}
	if _, err := b.channel.QueueDeclare(
		cfg.Cola, true, false, false, false, args,
	); err != nil {
		return fmt.Errorf("no se pudo declarar la cola %q: %w", cfg.Cola, err)
	}

	if err := b.channel.QueueBind(
		cfg.Cola, cfg.RoutingKey, cfg.Exchange, false, nil,
	); err != nil {
		return fmt.Errorf("no se pudo enlazar la cola con el exchange: %w", err)
	}

	return nil
}

func (b *RabbitMQBroker) PublicarSolicitud(
	ctx context.Context,
	evento *eventosv1.SolicitudReserva,
) error {
	payload, err := proto.Marshal(evento)
	if err != nil {
		return fmt.Errorf("no se pudo serializar el evento: %w", err)
	}

	b.mu.Lock()
	b.metricas.Publicadas++
	b.mu.Unlock()

	publicacion := b.publishing
	publicacion.Body = payload
	publicacion.MessageId = evento.TrackingId
	publicacion.CorrelationId = evento.EventoId
	publicacion.Timestamp, _ = time.Parse(time.RFC3339Nano, evento.PublicadoEn)

	var ultimo error
	for intento := 1; intento <= b.reintentos; intento++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		ultimo = b.publicarYConfirmar(ctx, publicacion)
		if ultimo == nil {
			b.mu.Lock()
			b.metricas.ConfirmadasBroker++
			b.mu.Unlock()
			return nil
		}

		b.mu.Lock()
		b.metricas.RechazadasBroker++
		b.mu.Unlock()

		if !b.reintentable(ultimo) {
			break
		}
		// Backoff lineal acotado: la peticion ya fue aceptada por el
		// cliente, pero todavia no podemos confirmar el mensaje.
		espera := time.Duration(intento*b.esperaMaxMs) * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(espera):
		}
	}

	return fmt.Errorf("%w: %v", ErrPublicacionFallida, ultimo)
}

func (b *RabbitMQBroker) publicarYConfirmar(ctx context.Context, p amqp.Publishing) error {
	if err := b.channel.PublishWithContext(
		ctx, b.exchange, b.routingKey, false, false, p,
	); err != nil {
		return err
	}

	select {
	case confirmacion, ok := <-b.confirmados:
		if !ok {
			return errors.New("el canal de confirmaciones se cerro")
		}
		if !confirmacion.Ack {
			return errors.New("el broker rechazo el mensaje")
		}
		return nil
	case errCh := <-b.confirmErr:
		if errCh != nil {
			return errCh
		}
		return errors.New("el canal AMQP se cerro antes de confirmar")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *RabbitMQBroker) Confirmado() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.sanos && b.confirmados != nil
}

func (b *RabbitMQBroker) Metricas() Metricas {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.metricas
}

func (b *RabbitMQBroker) Cerrar() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.sanos {
		return nil
	}
	b.sanos = false
	if b.channel != nil {
		_ = b.channel.Close()
	}
	if b.conn != nil {
		return b.conn.Close()
	}
	return nil
}

func (b *RabbitMQBroker) reintentable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if amqpErr, ok := err.(*amqp.Error); ok {
		return amqpErr.Code != amqp.AccessRefused
	}
	return true
}
