package restapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// OrígenesPermitidos son los dominios del frontend desplegado en Vercel.
// Se sobreescriben con CORS_ORIGENES en el compose de la VM.
func OrigenesPermitidos(valor string) []string {
	if valor == "" {
		return []string{"http://localhost:3000", "https://vercel.app"}
	}
	var lista []string
	for _, origen := range splitComas(valor) {
		if origen != "" {
			lista = append(lista, origen)
		}
	}
	return lista
}

func splitComas(valor string) []string {
	var partes []string
	actual := ""
	for _, r := range valor {
		if r == ',' {
			partes = append(partes, actual)
			actual = ""
			continue
		}
		actual += string(r)
	}
	return append(partes, actual)
}

// NuevoRouter construye el enrutador con las rutas del servicio de reservas.
// Separar el router de los manejadores mantiene cada archivo con una sola
// responsabilidad: uno declara rutas, otro implementa casos de uso.
func NuevoRouter(m *Manejador, origenes []string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery(), requestID(), CORS(origenes))

	router.GET("/api/salud", m.Salud)
	router.GET("/api/reservas/metricas", m.Metricas)
	router.POST("/api/reservas", m.CrearReserva)
	router.GET("/api/reservas/:trackingId/estado", m.ConsultarEstado)

	return router
}

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-Id")
		if id == "" {
			id = uuid.NewString()
		}
		c.Set("requestId", id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

// CORS es obligatorio: el navegador del estudiante llama desde el dominio de
// Vercel a la IP publica de la VM, que es un origen distinto.
func CORS(origenesPermitidos []string) gin.HandlerFunc {
	permitidos := make(map[string]bool, len(origenesPermitidos))
	for _, o := range origenesPermitidos {
		permitidos[o] = true
	}

	return func(c *gin.Context) {
		origen := c.GetHeader("Origin")
		if permitidos[origen] {
			c.Header("Access-Control-Allow-Origin", origen)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id")
		c.Header("Access-Control-Max-Age", "600")
		c.Header("Access-Control-Expose-Headers", "X-Request-Id")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
