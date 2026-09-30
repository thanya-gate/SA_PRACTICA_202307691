from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EstadoReserva(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ESTADO_RESERVA_NO_ESPECIFICADO: _ClassVar[EstadoReserva]
    PENDIENTE: _ClassVar[EstadoReserva]
    CONFIRMADA: _ClassVar[EstadoReserva]
    RECHAZADA: _ClassVar[EstadoReserva]
    SIN_CUPO: _ClassVar[EstadoReserva]
ESTADO_RESERVA_NO_ESPECIFICADO: EstadoReserva
PENDIENTE: EstadoReserva
CONFIRMADA: EstadoReserva
RECHAZADA: EstadoReserva
SIN_CUPO: EstadoReserva

class SolicitudReserva(_message.Message):
    __slots__ = ("tracking_id", "evento_id", "estudiante_nombre", "estudiante_correo", "canal", "publicado_en", "intento")
    TRACKING_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    ESTUDIANTE_NOMBRE_FIELD_NUMBER: _ClassVar[int]
    ESTUDIANTE_CORREO_FIELD_NUMBER: _ClassVar[int]
    CANAL_FIELD_NUMBER: _ClassVar[int]
    PUBLICADO_EN_FIELD_NUMBER: _ClassVar[int]
    INTENTO_FIELD_NUMBER: _ClassVar[int]
    tracking_id: str
    evento_id: str
    estudiante_nombre: str
    estudiante_correo: str
    canal: str
    publicado_en: str
    intento: int
    def __init__(self, tracking_id: _Optional[str] = ..., evento_id: _Optional[str] = ..., estudiante_nombre: _Optional[str] = ..., estudiante_correo: _Optional[str] = ..., canal: _Optional[str] = ..., publicado_en: _Optional[str] = ..., intento: _Optional[int] = ...) -> None: ...

class ResultadoReserva(_message.Message):
    __slots__ = ("tracking_id", "reserva_id", "evento_id", "estado", "mensaje", "ticket", "procesado_en", "motivo_rechazo")
    TRACKING_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVA_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    MENSAJE_FIELD_NUMBER: _ClassVar[int]
    TICKET_FIELD_NUMBER: _ClassVar[int]
    PROCESADO_EN_FIELD_NUMBER: _ClassVar[int]
    MOTIVO_RECHAZO_FIELD_NUMBER: _ClassVar[int]
    tracking_id: str
    reserva_id: str
    evento_id: str
    estado: EstadoReserva
    mensaje: str
    ticket: TicketPase
    procesado_en: str
    motivo_rechazo: str
    def __init__(self, tracking_id: _Optional[str] = ..., reserva_id: _Optional[str] = ..., evento_id: _Optional[str] = ..., estado: _Optional[_Union[EstadoReserva, str]] = ..., mensaje: _Optional[str] = ..., ticket: _Optional[_Union[TicketPase, _Mapping]] = ..., procesado_en: _Optional[str] = ..., motivo_rechazo: _Optional[str] = ...) -> None: ...

class TicketPase(_message.Message):
    __slots__ = ("codigo_validacion", "firma", "emitido_en", "evento_id", "titular", "evento_titulo")
    CODIGO_VALIDACION_FIELD_NUMBER: _ClassVar[int]
    FIRMA_FIELD_NUMBER: _ClassVar[int]
    EMITIDO_EN_FIELD_NUMBER: _ClassVar[int]
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    TITULAR_FIELD_NUMBER: _ClassVar[int]
    EVENTO_TITULO_FIELD_NUMBER: _ClassVar[int]
    codigo_validacion: str
    firma: str
    emitido_en: str
    evento_id: str
    titular: str
    evento_titulo: str
    def __init__(self, codigo_validacion: _Optional[str] = ..., firma: _Optional[str] = ..., emitido_en: _Optional[str] = ..., evento_id: _Optional[str] = ..., titular: _Optional[str] = ..., evento_titulo: _Optional[str] = ...) -> None: ...

class ResultadoReservaEnvelope(_message.Message):
    __slots__ = ("resultado", "cola_origen")
    RESULTADO_FIELD_NUMBER: _ClassVar[int]
    COLA_ORIGEN_FIELD_NUMBER: _ClassVar[int]
    resultado: ResultadoReserva
    cola_origen: str
    def __init__(self, resultado: _Optional[_Union[ResultadoReserva, _Mapping]] = ..., cola_origen: _Optional[str] = ...) -> None: ...
