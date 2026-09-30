from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EstadoEvento(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ESTADO_EVENTO_NO_ESPECIFICADO: _ClassVar[EstadoEvento]
    PROGRAMADO: _ClassVar[EstadoEvento]
    EN_CURSO: _ClassVar[EstadoEvento]
    FINALIZADO: _ClassVar[EstadoEvento]
    CANCELADO: _ClassVar[EstadoEvento]

class ResultadoCupo(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RESULTADO_CUPO_NO_ESPECIFICADO: _ClassVar[ResultadoCupo]
    CUPO_ASIGNADO: _ClassVar[ResultadoCupo]
    SIN_CUPO: _ClassVar[ResultadoCupo]
    EVENTO_INEXISTENTE: _ClassVar[ResultadoCupo]
    EVENTO_CERRADO: _ClassVar[ResultadoCupo]
    YA_OCUPADO: _ClassVar[ResultadoCupo]
ESTADO_EVENTO_NO_ESPECIFICADO: EstadoEvento
PROGRAMADO: EstadoEvento
EN_CURSO: EstadoEvento
FINALIZADO: EstadoEvento
CANCELADO: EstadoEvento
RESULTADO_CUPO_NO_ESPECIFICADO: ResultadoCupo
CUPO_ASIGNADO: ResultadoCupo
SIN_CUPO: ResultadoCupo
EVENTO_INEXISTENTE: ResultadoCupo
EVENTO_CERRADO: ResultadoCupo
YA_OCUPADO: ResultadoCupo

class HealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthResponse(_message.Message):
    __slots__ = ("estado", "version", "dependencia_postgres", "dependencia_redis", "cache_operativo")
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DEPENDENCIA_POSTGRES_FIELD_NUMBER: _ClassVar[int]
    DEPENDENCIA_REDIS_FIELD_NUMBER: _ClassVar[int]
    CACHE_OPERATIVO_FIELD_NUMBER: _ClassVar[int]
    estado: str
    version: str
    dependencia_postgres: str
    dependencia_redis: str
    cache_operativo: str
    def __init__(self, estado: _Optional[str] = ..., version: _Optional[str] = ..., dependencia_postgres: _Optional[str] = ..., dependencia_redis: _Optional[str] = ..., cache_operativo: _Optional[str] = ...) -> None: ...

class ListarEventosRequest(_message.Message):
    __slots__ = ("busqueda", "limite", "offset", "solo_con_cupo")
    BUSQUEDA_FIELD_NUMBER: _ClassVar[int]
    LIMITE_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    SOLO_CON_CUPO_FIELD_NUMBER: _ClassVar[int]
    busqueda: str
    limite: int
    offset: int
    solo_con_cupo: bool
    def __init__(self, busqueda: _Optional[str] = ..., limite: _Optional[int] = ..., offset: _Optional[int] = ..., solo_con_cupo: bool = ...) -> None: ...

class ListarEventosResponse(_message.Message):
    __slots__ = ("eventos", "total", "origen_cache")
    EVENTOS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    ORIGEN_CACHE_FIELD_NUMBER: _ClassVar[int]
    eventos: _containers.RepeatedCompositeFieldContainer[EventoResumen]
    total: int
    origen_cache: bool
    def __init__(self, eventos: _Optional[_Iterable[_Union[EventoResumen, _Mapping]]] = ..., total: _Optional[int] = ..., origen_cache: bool = ...) -> None: ...

class ObtenerEventoRequest(_message.Message):
    __slots__ = ("evento_id",)
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    def __init__(self, evento_id: _Optional[str] = ...) -> None: ...

class ObtenerEventoResponse(_message.Message):
    __slots__ = ("evento", "origen_cache")
    EVENTO_FIELD_NUMBER: _ClassVar[int]
    ORIGEN_CACHE_FIELD_NUMBER: _ClassVar[int]
    evento: EventoDetalle
    origen_cache: bool
    def __init__(self, evento: _Optional[_Union[EventoDetalle, _Mapping]] = ..., origen_cache: bool = ...) -> None: ...

class EventoResumen(_message.Message):
    __slots__ = ("evento_id", "titulo", "curso", "ponente", "fecha", "modalidad", "cupos_disponibles", "cupos_totales", "estado")
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    CURSO_FIELD_NUMBER: _ClassVar[int]
    PONENTE_FIELD_NUMBER: _ClassVar[int]
    FECHA_FIELD_NUMBER: _ClassVar[int]
    MODALIDAD_FIELD_NUMBER: _ClassVar[int]
    CUPOS_DISPONIBLES_FIELD_NUMBER: _ClassVar[int]
    CUPOS_TOTALES_FIELD_NUMBER: _ClassVar[int]
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    titulo: str
    curso: str
    ponente: str
    fecha: str
    modalidad: str
    cupos_disponibles: int
    cupos_totales: int
    estado: EstadoEvento
    def __init__(self, evento_id: _Optional[str] = ..., titulo: _Optional[str] = ..., curso: _Optional[str] = ..., ponente: _Optional[str] = ..., fecha: _Optional[str] = ..., modalidad: _Optional[str] = ..., cupos_disponibles: _Optional[int] = ..., cupos_totales: _Optional[int] = ..., estado: _Optional[_Union[EstadoEvento, str]] = ...) -> None: ...

class EventoDetalle(_message.Message):
    __slots__ = ("evento_id", "titulo", "curso", "ponente", "correo_ponente", "fecha", "modalidad", "descripcion", "prerrequisitos", "cupos_disponibles", "cupos_totales", "estado")
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    CURSO_FIELD_NUMBER: _ClassVar[int]
    PONENTE_FIELD_NUMBER: _ClassVar[int]
    CORREO_PONENTE_FIELD_NUMBER: _ClassVar[int]
    FECHA_FIELD_NUMBER: _ClassVar[int]
    MODALIDAD_FIELD_NUMBER: _ClassVar[int]
    DESCRIPCION_FIELD_NUMBER: _ClassVar[int]
    PRERREQUISITOS_FIELD_NUMBER: _ClassVar[int]
    CUPOS_DISPONIBLES_FIELD_NUMBER: _ClassVar[int]
    CUPOS_TOTALES_FIELD_NUMBER: _ClassVar[int]
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    titulo: str
    curso: str
    ponente: str
    correo_ponente: str
    fecha: str
    modalidad: str
    descripcion: str
    prerrequisitos: _containers.RepeatedScalarFieldContainer[str]
    cupos_disponibles: int
    cupos_totales: int
    estado: EstadoEvento
    def __init__(self, evento_id: _Optional[str] = ..., titulo: _Optional[str] = ..., curso: _Optional[str] = ..., ponente: _Optional[str] = ..., correo_ponente: _Optional[str] = ..., fecha: _Optional[str] = ..., modalidad: _Optional[str] = ..., descripcion: _Optional[str] = ..., prerrequisitos: _Optional[_Iterable[str]] = ..., cupos_disponibles: _Optional[int] = ..., cupos_totales: _Optional[int] = ..., estado: _Optional[_Union[EstadoEvento, str]] = ...) -> None: ...

class ValidarEventoRequest(_message.Message):
    __slots__ = ("evento_id",)
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    def __init__(self, evento_id: _Optional[str] = ...) -> None: ...

class ValidarEventoResponse(_message.Message):
    __slots__ = ("existe", "admite_reserva", "titulo", "estado", "motivo")
    EXISTE_FIELD_NUMBER: _ClassVar[int]
    ADMITE_RESERVA_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    MOTIVO_FIELD_NUMBER: _ClassVar[int]
    existe: bool
    admite_reserva: bool
    titulo: str
    estado: EstadoEvento
    motivo: str
    def __init__(self, existe: bool = ..., admite_reserva: bool = ..., titulo: _Optional[str] = ..., estado: _Optional[_Union[EstadoEvento, str]] = ..., motivo: _Optional[str] = ...) -> None: ...

class ConsultarDisponibilidadRequest(_message.Message):
    __slots__ = ("evento_id",)
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    def __init__(self, evento_id: _Optional[str] = ...) -> None: ...

class DisponibilidadResponse(_message.Message):
    __slots__ = ("evento_id", "cupos_disponibles", "cupos_totales", "admite_reserva")
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    CUPOS_DISPONIBLES_FIELD_NUMBER: _ClassVar[int]
    CUPOS_TOTALES_FIELD_NUMBER: _ClassVar[int]
    ADMITE_RESERVA_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    cupos_disponibles: int
    cupos_totales: int
    admite_reserva: bool
    def __init__(self, evento_id: _Optional[str] = ..., cupos_disponibles: _Optional[int] = ..., cupos_totales: _Optional[int] = ..., admite_reserva: bool = ...) -> None: ...

class InvalidarCacheRequest(_message.Message):
    __slots__ = ("evento_id",)
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    def __init__(self, evento_id: _Optional[str] = ...) -> None: ...

class InvalidarCacheResponse(_message.Message):
    __slots__ = ("invalidado",)
    INVALIDADO_FIELD_NUMBER: _ClassVar[int]
    invalidado: bool
    def __init__(self, invalidado: bool = ...) -> None: ...

class ReclamarCupoRequest(_message.Message):
    __slots__ = ("evento_id", "reserva_id", "tracking_id")
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVA_ID_FIELD_NUMBER: _ClassVar[int]
    TRACKING_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    reserva_id: str
    tracking_id: str
    def __init__(self, evento_id: _Optional[str] = ..., reserva_id: _Optional[str] = ..., tracking_id: _Optional[str] = ...) -> None: ...

class ReclamarCupoResponse(_message.Message):
    __slots__ = ("resultado", "cupos_disponibles", "cupos_totales", "titulo", "mensaje")
    RESULTADO_FIELD_NUMBER: _ClassVar[int]
    CUPOS_DISPONIBLES_FIELD_NUMBER: _ClassVar[int]
    CUPOS_TOTALES_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    MENSAJE_FIELD_NUMBER: _ClassVar[int]
    resultado: ResultadoCupo
    cupos_disponibles: int
    cupos_totales: int
    titulo: str
    mensaje: str
    def __init__(self, resultado: _Optional[_Union[ResultadoCupo, str]] = ..., cupos_disponibles: _Optional[int] = ..., cupos_totales: _Optional[int] = ..., titulo: _Optional[str] = ..., mensaje: _Optional[str] = ...) -> None: ...

class LiberarCupoRequest(_message.Message):
    __slots__ = ("evento_id", "reserva_id")
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVA_ID_FIELD_NUMBER: _ClassVar[int]
    evento_id: str
    reserva_id: str
    def __init__(self, evento_id: _Optional[str] = ..., reserva_id: _Optional[str] = ...) -> None: ...

class LiberarCupoResponse(_message.Message):
    __slots__ = ("liberado", "cupos_disponibles")
    LIBERADO_FIELD_NUMBER: _ClassVar[int]
    CUPOS_DISPONIBLES_FIELD_NUMBER: _ClassVar[int]
    liberado: bool
    cupos_disponibles: int
    def __init__(self, liberado: bool = ..., cupos_disponibles: _Optional[int] = ...) -> None: ...
