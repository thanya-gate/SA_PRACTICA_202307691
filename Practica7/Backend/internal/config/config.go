package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config lee y valida la configuracion desde el entorno. Concentrarlo aqui
// evita que cada paquete haga os.Getenv por su cuenta.
type Config struct {
	Version           string
	PuertoHTTP        string
	PuertoGRPC        string
	BrokerURL         string
	Exchange          string
	ColaSolicitudes   string
	RoutingKey        string
	ColaMuertos       string
	ExchangeMuertos   string
	RoutingKeyMuertos string
	RedisURL          string
	RedisTTL          time.Duration
	ReintentosBroker  int
	EsperaBrokerMS    int
	OrigenesCORS      string
}

func Cargar() (Config, error) {
	cfg := Config{
		Version:           env("VERSION_SERVICIO", "2.0.0"),
		PuertoHTTP:        env("PUERTO_HTTP", "8080"),
		PuertoGRPC:        env("PUERTO_GRPC", "50060"),
		BrokerURL:         env("BROKER_URL", "amqp://academix:academix@rabbitmq:5672/"),
		Exchange:          env("BROKER_EXCHANGE", "academix.reservas"),
		ColaSolicitudes:   env("BROKER_COLA", "academix.reservas.solicitudes"),
		RoutingKey:        env("BROKER_ROUTING_KEY", "reserva.solicitada"),
		ColaMuertos:       env("BROKER_COLA_MUERTOS", "academix.reservas.dlq"),
		ExchangeMuertos:   env("BROKER_EXCHANGE_MUERTOS", "academix.reservas.dlx"),
		RoutingKeyMuertos: env("BROKER_ROUTING_KEY_MUERTOS", "reserva.descartada"),
		RedisURL:          env("REDIS_ADDR", "redis:6379"),
		RedisTTL:          time.Duration(envInt("REDIS_TTL_SEGUNDOS", 86400)) * time.Second,
		ReintentosBroker:  envInt("BROKER_REINTENTOS", 3),
		EsperaBrokerMS:    envInt("BROKER_ESPERA_MS", 250),
		OrigenesCORS:      env("CORS_ORIGENES", ""),
	}

	if cfg.BrokerURL == "" {
		return Config{}, fmt.Errorf("BROKER_URL es obligatorio")
	}
	return cfg, nil
}

func (c Config) TimeoutPublicacion() time.Duration {
	return time.Duration(c.ReintentosBroker*c.EsperaBrokerMS+2000) * time.Millisecond
}

func env(clave, porDefecto string) string {
	if v := os.Getenv(clave); v != "" {
		return v
	}
	return porDefecto
}

func envInt(clave string, porDefecto int) int {
	v := os.Getenv(clave)
	if v == "" {
		return porDefecto
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return porDefecto
	}
	return n
}
