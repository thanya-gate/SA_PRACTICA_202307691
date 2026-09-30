// Paquete domain contiene el modelo de negocio y los errores del servicio.
// No depende de HTTP, gRPC, RabbitMQ, Redis ni de ningun adaptador: es la
// capa mas interna de la hexagonalia y la unica que conoce el vocabulario
// del negocio.
package domain

import (
	"errors"
	"fmt"
	"strings"
)

// EstadoReserva replica la enumeracion del contrato eventos.proto.
type EstadoReserva string

const (
	EstadoPendiente  EstadoReserva = "PENDIENTE"
	EstadoConfirmada EstadoReserva = "CONFIRMADA"
	EstadoRechazada  EstadoReserva = "RECHAZADA"
	EstadoSinCupo    EstadoReserva = "SIN_CUPO"
)

// Errores de dominio. La capa de interfaces los traduce a codigos HTTP.
var (
	ErrCamposInvalidos    = errors.New("la solicitud no cumple el formato requerido")
	ErrCorreoInvalido     = errors.New("el correo no pertenece a un dominio permitido")
	ErrBrokerNoDisponible = errors.New("el broker no confirmo la publicacion")
	ErrSeguimientoVacio   = errors.New("el identificador de seguimiento es obligatorio")
)

// SolicitudReserva es la peticion normalizada que el productor acepta desde
// el borde. Todavia no es un evento de dominio: no tiene identificador de
// seguimiento ni fecha de publicacion.
type SolicitudReserva struct {
	EventoID         string
	EstudianteNombre string
	EstudianteCorreo string
	Canal            string
}

// Normalizar aplica las reglas de validacion Sintactica exigidas por la
// especificacion. NO consulta el catalogo ni el broker: la disponibilidad
// de cupo es responsabilidad exclusiva del consumidor asincrono.
func (s SolicitudReserva) Normalizar() (SolicitudReserva, error) {
	out := SolicitudReserva{
		EventoID:         strings.TrimSpace(s.EventoID),
		EstudianteNombre: strings.TrimSpace(s.EstudianteNombre),
		EstudianteCorreo: strings.ToLower(strings.TrimSpace(s.EstudianteCorreo)),
		Canal:            strings.TrimSpace(s.Canal),
	}

	if out.Canal == "" {
		out.Canal = "web"
	}

	switch {
	case out.EventoID == "":
		return SolicitudReserva{}, fmt.Errorf("%w: evento_id es obligatorio", ErrCamposInvalidos)
	case len(out.EventoID) > 64:
		return SolicitudReserva{}, fmt.Errorf("%w: evento_id excede 64 caracteres", ErrCamposInvalidos)
	case len(out.EstudianteNombre) < 3:
		return SolicitudReserva{}, fmt.Errorf("%w: el nombre debe tener al menos 3 caracteres", ErrCamposInvalidos)
	case len(out.EstudianteNombre) > 120:
		return SolicitudReserva{}, fmt.Errorf("%w: el nombre excede 120 caracteres", ErrCamposInvalidos)
	case !strings.Contains(out.EstudianteCorreo, "@"):
		return SolicitudReserva{}, fmt.Errorf("%w: el correo no tiene un formato valido", ErrCamposInvalidos)
	case !dominioPermitido(out.EstudianteCorreo):
		return SolicitudReserva{}, fmt.Errorf("%w: %s", ErrCorreoInvalido, "use un correo institucional o de demostracion")
	}

	return out, nil
}

func dominioPermitido(correo string) bool {
	partes := strings.Split(correo, "@")
	if len(partes) != 2 {
		return false
	}
	dominio := partes[1]
	return strings.HasSuffix(dominio, "usac.edu.gt") || strings.HasSuffix(dominio, "demo.test")
}

// Seguimiento es el identificador que el productor devuelve de inmediato al
// cliente. El worker lo usa para escribir el resultado y el cliente lo usa
// para consultar el estado sin haber esperado a la base de datos.
type Seguimiento struct {
	TrackingID  string
	Estado      EstadoReserva
	Mensaje     string
	PublicadoEn string
	Intento     int
}

// EstadoConsultado es la lectura de estado que el productor expone. Se
// arma desde la cache de seguimiento (Redis); la base de datos sigue siendo
// la fuente de verdad, pero no se consulta en el camino caliente.
type EstadoConsultado struct {
	TrackingID   string
	ReservaID    string
	Encontrado   bool
	Estado       EstadoReserva
	Mensaje      string
	ProcesadoEn  string
	CodigoPase   string
	FirmaPase    string
	TitularPase  string
	TituloEvento string
}
