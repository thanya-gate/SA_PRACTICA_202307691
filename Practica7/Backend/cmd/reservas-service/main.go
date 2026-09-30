// Comando de entrada del Servicio de Reservas / Ticketing (PRODUCTOR).
//
// El servicio es stateless: no abre conexiones a la base de datos de
// reservas. Recibe la peticion, la valida sintacticamente, genera el
// identificador de seguimiento, publica el evento en RabbitMQ esperando
// confirmacion de entrega y responde 202 Accepted.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yousac/academix-pass/backend/gen/reservasv1"
	"github.com/yousac/academix-pass/backend/internal/application"
	"github.com/yousac/academix-pass/backend/internal/application/ports"
	"github.com/yousac/academix-pass/backend/internal/config"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/cache"
	grpcapi "github.com/yousac/academix-pass/backend/internal/infrastructure/grpcapi"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/messaging"
	restapi "github.com/yousac/academix-pass/backend/internal/interfaces/restapi"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	if err := ejecutar(); err != nil {
		log.Fatalf("reservas-service: %v", err)
	}
}

func ejecutar() error {
	cfg, err := config.Cargar()
	if err != nil {
		return err
	}

	broker, err := messaging.NuevoRabbitMQBroker(messaging.ConfigBroker{
		URL:               cfg.BrokerURL,
		Exchange:          cfg.Exchange,
		Cola:              cfg.ColaSolicitudes,
		RoutingKey:        cfg.RoutingKey,
		ColaMuertos:       cfg.ColaMuertos,
		ExchangeMuertos:   cfg.ExchangeMuertos,
		RoutingKeyMuertos: cfg.RoutingKeyMuertos,
		Reintentos:        cfg.ReintentosBroker,
		EsperaMaximaMS:    cfg.EsperaBrokerMS,
	})
	if err != nil {
		return err
	}
	defer func() { _ = broker.Cerrar() }()

	estadoCache := cache.NuevoRedisEstadoCache(cfg.RedisURL, cfg.RedisTTL)
	defer func() { _ = estadoCache.Cerrar() }()

	solicitar := application.NuevoSolicitarReserva(
		broker,
		application.NuevoGeneradorTracking(),
		application.NuevoRelojSistema(),
	)
	consultar := application.NuevoConsultarEstado(estadoCache)

	var _ ports.Broker = broker
	var _ ports.EstadoCache = estadoCache

	manejador := restapi.NuevoManejador(solicitar, consultar, broker, cfg.Version)
	router := restapi.NuevoRouter(manejador, restapi.OrigenesPermitidos(cfg.OrigenesCORS))

	servidorHTTP := &http.Server{
		Addr:              ":" + cfg.PuertoHTTP,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	listenerGRPC, err := net.Listen("tcp", ":"+cfg.PuertoGRPC)
	if err != nil {
		return err
	}
	servidorGRPC := grpc.NewServer()
	reservasv1.RegisterReservasServiceServer(
		servidorGRPC, grpcapi.NuevoServidor(solicitar, consultar, broker))
	reflection.Register(servidorGRPC)

	errs := make(chan error, 2)
	go func() {
		log.Printf("HTTP escuchando en :%s", cfg.PuertoHTTP)
		if err := servidorHTTP.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()
	go func() {
		log.Printf("gRPC escuchando en :%s", cfg.PuertoGRPC)
		if err := servidorGRPC.Serve(listenerGRPC); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			errs <- err
		}
	}()

	apagado := make(chan os.Signal, 1)
	signal.Notify(apagado, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errs:
		return err
	case <-apagado:
		log.Println("apagando de forma ordenada...")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = servidorHTTP.Shutdown(ctx)
	servidorGRPC.GracefulStop()
	return nil
}
