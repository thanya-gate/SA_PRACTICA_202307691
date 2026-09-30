package restapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/yousac/academix-pass/backend/internal/application"
	"github.com/yousac/academix-pass/backend/internal/domain"
	"github.com/yousac/academix-pass/backend/internal/infrastructure/messaging"
)

// Manejador traduce HTTP a los casos de uso. No contiene reglas de negocio:
// normalizar, publicar y leer estado viven en application y domain.
type Manejador struct {
	solicitar *application.SolicitarReserva
	consultar *application.ConsultarEstado
	broker    *messaging.RabbitMQBroker
	version   string
}

func NuevoManejador(
	solicitar *application.SolicitarReserva,
	consultar *application.ConsultarEstado,
	broker *messaging.RabbitMQBroker,
	version string,
) *Manejador {
	return &Manejador{solicitar: solicitar, consultar: consultar, broker: broker, version: version}
}

// CrearReserva responde 202 Accepted: la peticion quedo en la cola y el
// procesamiento asincrono sigue su curso. Nunca responde 200 con un boleto,
// porque el boleto lo emite el worker, no este servicio.
func (m *Manejador) CrearReserva(c *gin.Context) {
	var dto SolicitudReservaDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		responderError(c, http.StatusBadRequest, "SOLICITUD_INVALIDA",
			"El cuerpo de la peticion no es valido.", err.Error())
		return
	}

	seguimiento, err := m.solicitar.Ejecutar(c.Request.Context(), domain.SolicitudReserva{
		EventoID:         dto.EventoID,
		EstudianteNombre: dto.EstudianteNombre,
		EstudianteCorreo: dto.EstudianteCorreo,
		Canal:            dto.Canal,
	})
	if err != nil {
		responderError(c, http.StatusUnprocessableEntity, "SOLICITUD_INVALIDA",
			err.Error(), "")
		return
	}

	c.JSON(http.StatusAccepted, AceptadaDTO{
		TrackingID:     seguimiento.TrackingID,
		Estado:         string(seguimiento.Estado),
		Mensaje:        seguimiento.Mensaje,
		URLSeguimiento: "/api/reservas/" + seguimiento.TrackingID + "/estado",
	})
}

// ConsultarEstado implementa CU-P7-04 sobre la cache de seguimiento.
func (m *Manejador) ConsultarEstado(c *gin.Context) {
	estado, err := m.consultar.Ejecutar(c.Request.Context(), c.Param("trackingId"))
	if err != nil {
		if errors.Is(err, domain.ErrSeguimientoVacio) {
			responderError(c, http.StatusBadRequest, "SEGUIMIENTO_INVALIDO", err.Error(), "")
			return
		}
		responderError(c, http.StatusInternalServerError, "ERROR_INTERNO", err.Error(), "")
		return
	}

	respuesta := EstadoReservaDTO{
		TrackingID:  estado.TrackingID,
		ReservaID:   estado.ReservaID,
		Estado:      string(estado.Estado),
		Mensaje:     estado.Mensaje,
		ProcesadoEn: estado.ProcesadoEn,
		Encontrado:  estado.Encontrado,
	}

	if estado.CodigoPase != "" {
		respuesta.Ticket = &TicketDTO{
			TicketID:         estado.CodigoPase,
			CodigoValidacion: estado.CodigoPase,
			Firma:            estado.FirmaPase,
			EmitidoEn:        estado.ProcesadoEn,
			EventoTitulo:     estado.TituloEvento,
			Titular:          estado.TitularPase,
		}
	}

	c.JSON(http.StatusOK, respuesta)
}

// Metricas expone los contadores del productor.
func (m *Manejador) Metricas(c *gin.Context) {
	if m.broker == nil {
		c.JSON(http.StatusOK, MetricasDTO{})
		return
	}
	mt := m.broker.Metricas()
	c.JSON(http.StatusOK, MetricasDTO{
		Publicadas:        mt.Publicadas,
		ConfirmadasBroker: mt.ConfirmadasBroker,
		RechazadasBroker:  mt.RechazadasBroker,
		Duplicadas:        mt.Duplicadas,
	})
}

// Salud reporta el estado del servicio y del broker.
func (m *Manejador) Salud(c *gin.Context) {
	estado := "ok"
	broker := "no configurado"
	if m.broker != nil {
		if m.broker.Confirmado() {
			broker = "con confirmaciones activas"
		} else {
			estado = "degradado"
			broker = "sin confirmaciones"
		}
	}

	c.JSON(http.StatusOK, SaludDTO{
		Estado:   estado,
		Version:  m.version,
		Servicio: "reservas-service",
		Detalle:  map[string]string{"broker": broker},
	})
}

func responderError(c *gin.Context, status int, codigo, mensaje, detalle string) {
	c.AbortWithStatusJSON(status, ErrorDTO{
		Codigo:    codigo,
		Mensaje:   mensaje,
		Detalle:   detalle,
		RequestID: c.GetString("requestId"),
	})
}
