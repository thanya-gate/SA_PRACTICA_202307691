// Paquete http expone los casos de uso del productor por REST.
// Es la unica capa que conoce gin, los codigos HTTP y el formato JSON.
package restapi

// SolicitudReservaDTO es el cuerpo que recibe el frontend desplegado en
// Vercel. Solo transporta datos: ninguna regla de negocio vive aqui.
type SolicitudReservaDTO struct {
	EventoID         string `json:"eventoId" binding:"required"`
	EstudianteNombre string `json:"estudianteNombre" binding:"required"`
	EstudianteCorreo string `json:"estudianteCorreo" binding:"required"`
	Canal            string `json:"canal"`
}

// AceptadaDTO es la respuesta 202 Accepted. El frontend guarda trackingId
// y consulta el estado con el, tal como describe CU-P7-04.
type AceptadaDTO struct {
	TrackingID     string `json:"trackingId"`
	Estado         string `json:"estado"`
	Mensaje        string `json:"mensaje"`
	URLSeguimiento string `json:"urlSeguimiento"`
}

// EstadoReservaDTO responde a la consulta de seguimiento.
type EstadoReservaDTO struct {
	TrackingID  string     `json:"trackingId"`
	ReservaID   string     `json:"reservaId,omitempty"`
	Estado      string     `json:"estado"`
	Mensaje     string     `json:"mensaje"`
	ProcesadoEn string     `json:"procesadoEn,omitempty"`
	Encontrado  bool       `json:"encontrado"`
	Ticket      *TicketDTO `json:"ticket,omitempty"`
}

// TicketDTO expone el pase emitido por el worker.
type TicketDTO struct {
	TicketID         string `json:"ticketId"`
	CodigoValidacion string `json:"codigoValidacion"`
	Firma            string `json:"firma"`
	EmitidoEn        string `json:"emitidoEn"`
	EventoTitulo     string `json:"eventoTitulo"`
	Titular          string `json:"titular"`
}

// ErrorDTO es la forma unica de error de la API.
type ErrorDTO struct {
	Codigo    string `json:"codigo"`
	Mensaje   string `json:"mensaje"`
	Detalle   string `json:"detalle,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// MetricasDTO expone los contadores del productor para la evidencia de la
// practica (mensajes publicados y confirmados por el broker).
type MetricasDTO struct {
	Publicadas        int64 `json:"publicadas"`
	ConfirmadasBroker int64 `json:"confirmadasBroker"`
	RechazadasBroker  int64 `json:"rechazadasBroker"`
	Duplicadas        int64 `json:"duplicadas"`
}

// SaludDTO es la respuesta de /api/salud en cada servicio.
type SaludDTO struct {
	Estado   string            `json:"estado"`
	Version  string            `json:"version"`
	Servicio string            `json:"servicio"`
	Detalle  map[string]string `json:"detalle,omitempty"`
}
