package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/yousac/academix-pass/backend/gen/eventosv1"
	"github.com/yousac/academix-pass/backend/internal/application"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/cache"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/messaging"
	restapi "github.com/yousac/academix-pass/backend/internal/interfaces/restapi"
)

const origenVercel = "https://academix-pass.vercel.app"

func nuevoRouterDePrueba(broker *messaging.BrokerEnMemoria, cacheEstado *cache.EstadoCacheEnMemoria) *gin.Engine {
	return nuevoRouterConOrigenes(broker, cacheEstado, origenVercel)
}

func nuevoRouterConOrigenes(
	broker *messaging.BrokerEnMemoria,
	cacheEstado *cache.EstadoCacheEnMemoria,
	origenes string,
) *gin.Engine {
	manejador := restapi.NuevoManejador(
		application.NuevoSolicitarReserva(broker, trackingFijo{valor: "TRK-HTTP-1"}, relojFijo{}),
		application.NuevoConsultarEstado(cacheEstado),
		nil,
		"2.0.0-test",
	)
	return restapi.NuevoRouter(manejador, restapi.OrigenesPermitidos(origenes))
}

func TestPostReservasDevuelve202Accepted(t *testing.T) {
	broker := messaging.NuevoBrokerEnMemoria()
	router := nuevoRouterDePrueba(broker, cache.NuevoEstadoCacheEnMemoria())

	cuerpo := `{"eventoId":"EVT-2026-003","estudianteNombre":"Ana Lopez","estudianteCorreo":"ana@usac.edu.gt","canal":"vercel"}`
	req := httptest.NewRequest(http.MethodPost, "/api/reservas", bytes.NewBufferString(cuerpo))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origenVercel)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("se esperaba 202 Accepted, se obtuvo %d con cuerpo %s", rec.Code, rec.Body.String())
	}

	var respuesta restapi.AceptadaDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &respuesta); err != nil {
		t.Fatalf("respuesta no es JSON valido: %v", err)
	}
	if respuesta.TrackingID == "" {
		t.Error("el 202 debe traer el identificador de seguimiento")
	}
	if respuesta.Estado != "PENDIENTE" {
		t.Errorf("el estado inicial debe ser PENDIENTE, se obtuvo %q", respuesta.Estado)
	}
	if len(broker.Publicados()) != 1 {
		t.Error("el evento no llego al broker")
	}
}

func TestPostReservasDevuelve422ConSolicitudInvalida(t *testing.T) {
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cache.NuevoEstadoCacheEnMemoria())

	cuerpo := `{"eventoId":"EVT-1","estudianteNombre":"Ana","estudianteCorreo":"ana@ejemplo.com"}`
	req := httptest.NewRequest(http.MethodPost, "/api/reservas", bytes.NewBufferString(cuerpo))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("se esperaba 422, se obtuvo %d", rec.Code)
	}
}

func TestPostReservasDevuelve400ConCuerpoInvalido(t *testing.T) {
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cache.NuevoEstadoCacheEnMemoria())

	req := httptest.NewRequest(http.MethodPost, "/api/reservas", bytes.NewBufferString("{no-json"))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("se esperaba 400, se obtuvo %d", rec.Code)
	}
}

func TestConsultarEstadoDevuelveElTicketEmitido(t *testing.T) {
	cacheEstado := cache.NuevoEstadoCacheEnMemoria()
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cacheEstado)

	resultado := &eventosv1.ResultadoReserva{
		TrackingId:  "TRK-HTTP-1",
		Estado:      eventosv1.EstadoReserva_SIN_CUPO,
		Mensaje:     "No quedan cupos disponibles.",
		ProcesadoEn: "2026-10-01T12:00:05Z",
	}
	if err := cacheEstado.GuardarResultado(context.Background(), resultado, 0); err != nil {
		t.Fatalf("no se pudo preparar la cache: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/reservas/TRK-HTTP-1/estado", nil)
	req.Header.Set("Origin", origenVercel)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("se esperaba 200, se obtuvo %d", rec.Code)
	}

	var respuesta restapi.EstadoReservaDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &respuesta); err != nil {
		t.Fatalf("respuesta no es JSON valido: %v", err)
	}
	if respuesta.Estado != "SIN_CUPO" {
		t.Errorf("estado esperado SIN_CUPO, se obtuvo %q", respuesta.Estado)
	}
	if !respuesta.Encontrado {
		t.Error("la respuesta debe indicar que el worker ya resolvio la solicitud")
	}
}

// CORS es indispensable: el navegador llama desde *.vercel.app a la IP de la VM.
func TestCORSPermiteElOrigenDeVercel(t *testing.T) {
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cache.NuevoEstadoCacheEnMemoria())

	req := httptest.NewRequest(http.MethodOptions, "/api/reservas", nil)
	req.Header.Set("Origin", origenVercel)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("un preflight exitoso responde 204, se obtuvo %d", rec.Code)
	}
	if origen := rec.Header().Get("Access-Control-Allow-Origin"); origen != origenVercel {
		t.Errorf("Access-Control-Allow-Origin = %q, se esperaba %q", origen, origenVercel)
	}
}

func TestCORSRechazaOrigenDesconocido(t *testing.T) {
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cache.NuevoEstadoCacheEnMemoria())

	req := httptest.NewRequest(http.MethodGet, "/api/salud", nil)
	req.Header.Set("Origin", "https://sitio-malicioso.example")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if origen := rec.Header().Get("Access-Control-Allow-Origin"); origen != "" {
		t.Errorf("no se debe devolver el encabezado para origenes no permitidos, se obtuvo %q", origen)
	}
}

// El compose deja CORS_ORIGENES en "*" cuando no se define. Ese comodin tiene
// que abrir la puerta a cualquier origen: tratado como cadena literal nunca
// coincide con el Origin real y el navegador rechaza la respuesta sin que el
// servicio llegue a responder nada.
func TestCORSComodinPermiteCualquierOrigen(t *testing.T) {
	router := nuevoRouterConOrigenes(
		messaging.NuevoBrokerEnMemoria(),
		cache.NuevoEstadoCacheEnMemoria(),
		"*",
	)

	origenes := []string{origenVercel, "http://localhost:3000", "https://otro-anything.example"}
	for _, origen := range origenes {
		req := httptest.NewRequest(http.MethodOptions, "/api/reservas", nil)
		req.Header.Set("Origin", origen)

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if permitido := rec.Header().Get("Access-Control-Allow-Origin"); permitido != "*" {
			t.Errorf("con el comodin, el origen %q recibio %q, se esperaba \"*\"", origen, permitido)
		}
	}
}

func TestRutaDeSaludResponde(t *testing.T) {
	router := nuevoRouterDePrueba(messaging.NuevoBrokerEnMemoria(), cache.NuevoEstadoCacheEnMemoria())

	req := httptest.NewRequest(http.MethodGet, "/api/salud", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("se esperaba 200, se obtuvo %d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("reservas-service")) {
		t.Errorf("la respuesta de salud debe identificar el servicio: %s", rec.Body.String())
	}
}
