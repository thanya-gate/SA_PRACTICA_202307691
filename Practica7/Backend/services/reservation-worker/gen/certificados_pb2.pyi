from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EstadoCredencial(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ESTADO_CREDENCIAL_NO_ESPECIFICADO: _ClassVar[EstadoCredencial]
    VALIDA: _ClassVar[EstadoCredencial]
    INVALIDA: _ClassVar[EstadoCredencial]
    NO_ENCONTRADA: _ClassVar[EstadoCredencial]
ESTADO_CREDENCIAL_NO_ESPECIFICADO: EstadoCredencial
VALIDA: EstadoCredencial
INVALIDA: EstadoCredencial
NO_ENCONTRADA: EstadoCredencial

class HealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthResponse(_message.Message):
    __slots__ = ("estado", "version", "dependencia_postgres")
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DEPENDENCIA_POSTGRES_FIELD_NUMBER: _ClassVar[int]
    estado: str
    version: str
    dependencia_postgres: str
    def __init__(self, estado: _Optional[str] = ..., version: _Optional[str] = ..., dependencia_postgres: _Optional[str] = ...) -> None: ...

class VerificarCredencialRequest(_message.Message):
    __slots__ = ("codigo", "exigir_firma")
    CODIGO_FIELD_NUMBER: _ClassVar[int]
    EXIGIR_FIRMA_FIELD_NUMBER: _ClassVar[int]
    codigo: str
    exigir_firma: bool
    def __init__(self, codigo: _Optional[str] = ..., exigir_firma: bool = ...) -> None: ...

class VerificarCredencialResponse(_message.Message):
    __slots__ = ("codigo", "estado", "titulo", "titular", "emitido_en", "mensaje")
    CODIGO_FIELD_NUMBER: _ClassVar[int]
    ESTADO_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    TITULAR_FIELD_NUMBER: _ClassVar[int]
    EMITIDO_EN_FIELD_NUMBER: _ClassVar[int]
    MENSAJE_FIELD_NUMBER: _ClassVar[int]
    codigo: str
    estado: EstadoCredencial
    titulo: str
    titular: str
    emitido_en: str
    mensaje: str
    def __init__(self, codigo: _Optional[str] = ..., estado: _Optional[_Union[EstadoCredencial, str]] = ..., titulo: _Optional[str] = ..., titular: _Optional[str] = ..., emitido_en: _Optional[str] = ..., mensaje: _Optional[str] = ...) -> None: ...

class RegistrarEmisionRequest(_message.Message):
    __slots__ = ("codigo", "titulo", "titular", "evento_id", "firma", "emitido_en", "reserva_id")
    CODIGO_FIELD_NUMBER: _ClassVar[int]
    TITULO_FIELD_NUMBER: _ClassVar[int]
    TITULAR_FIELD_NUMBER: _ClassVar[int]
    EVENTO_ID_FIELD_NUMBER: _ClassVar[int]
    FIRMA_FIELD_NUMBER: _ClassVar[int]
    EMITIDO_EN_FIELD_NUMBER: _ClassVar[int]
    RESERVA_ID_FIELD_NUMBER: _ClassVar[int]
    codigo: str
    titulo: str
    titular: str
    evento_id: str
    firma: str
    emitido_en: str
    reserva_id: str
    def __init__(self, codigo: _Optional[str] = ..., titulo: _Optional[str] = ..., titular: _Optional[str] = ..., evento_id: _Optional[str] = ..., firma: _Optional[str] = ..., emitido_en: _Optional[str] = ..., reserva_id: _Optional[str] = ...) -> None: ...

class RegistrarEmisionResponse(_message.Message):
    __slots__ = ("registrada", "ya_existia")
    REGISTRADA_FIELD_NUMBER: _ClassVar[int]
    YA_EXISTIA_FIELD_NUMBER: _ClassVar[int]
    registrada: bool
    ya_existia: bool
    def __init__(self, registrada: bool = ..., ya_existia: bool = ...) -> None: ...
