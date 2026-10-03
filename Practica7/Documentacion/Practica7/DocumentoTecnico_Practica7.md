# Documento técnico actualizado — YOUSAC Academix Pass & CertiHub

**Práctica:** 8 (continúacion de la documentación de Práctica 7)
**Curso:** Software Avanzado
**Institución:** Universidad de San Carlos de Guatemal

## Índice

1. [Introducción](#1-introducción)
2. [Objetivos](#2-objetivos)
3. [Identidad y relación con YOUSAC](#3-identidad-y-relación-con-yousac)
4. [Alcance del sistema](#4-alcance-del-sistema)
5. [Glosario del dominio](#5-glosario-del-dominio)
6. [Actores](#6-actores)
7. [Servicios del sistema](#7-servicios-del-sistema)
8. [Requerimientos del sistema](#8-requerimientos-del-sistema)
9. [Casos de uso de la fase inicial](#9-casos-de-uso-de-la-fase-inicial-práctica-7)
   9.1 [CU-P7-01: Consultar catálogo de eventos](#cu-p7-01-consultar-catálogo-de-eventos)
   9.2 [CU-P7-02: Consultar detalle y disponibilidad](#cu-p7-02-consultar-detalle-y-disponibilidad)
   9.3 [CU-P7-03: Solicitar reserva de cupo](#cu-p7-03-solicitar-reserva-de-cupo)
   9.4 [CU-P7-04: Consultar ticket y estado de reserva](#cu-p7-04-consultar-ticket-y-estado-de-reserva)
   9.5 [CU-P7-05: Verificar credencial digital](#cu-p7-05-verificar-credencial-digital)
   9.6 [Diagramas de casos de uso](#96-diagramas-de-casos-de-uso)
10. [Mockups UI/UX de Práctica 7](#10-mockups-uiux-de-práctica-7)
11. [Estados del dominio](#11-estados-del-dominio)
12. [Flujo de reserva implementado](#12-flujo-de-reserva-implementado)
13. [Contratos HTTP actuales y mocks históricos](#13-contratos-http-actuales-y-mocks-históricos)
14. [Supuestos y decisiones](#14-supuestos-y-decisiones)
15. [Diagrama Entidad Relación](#15-diagrama-entidad-relación)
16. [Vista 4+1](#16-vista-41)
17. [Arquitectura SOA de Práctica 8](#17-arquitectura-soa-de-práctica-8)
18. [Flujo asíncrono y diagrama de secuencia](#18-flujo-asíncrono-y-diagrama-de-secuencia)
19. [Arquitectura física de la VM de desarrollo](#19-arquitectura-física-de-la-vm-de-desarrollo)
20. [Matriz SOLID: productores y consumidores](#20-matriz-solid-productores-y-consumidores)
21. [Pipeline, enlaces y verificación](#21-pipeline-enlaces-y-verificación)
22. [Conclusiones](#22-conclusiones)

## 1. Introducción

La Facultad de Ingeniería requiere ampliar el ecosistema YOUSAC con un sistema
satélite orientado a actividades académicas de participación limitada. Este
sistema se denomina **YOUSAC Academix Pass & CertiHub** y atiende eventos que
requieren reserva de cupo, como talleres prácticos, conferencias interactivas,
laboratorios y actividades de certificación.

La diferencia principal respecto de YOUSAC es el dominio funcional. YOUSAC
centraliza clases grabadas y recursos de aprendizaje; Academix Pass & CertiHub
gestiona eventos con cupos limitados, solicitudes de reserva y validación de
credenciales digitales.

Práctica 7 definió las vistas, los contratos y la experiencia de usuario. En
Práctica 8 se implementaron los servicios de Catálogo y Certificados en
TypeScript, el productor de Reservas en Go, un worker consumidor en Python,
RabbitMQ, Redis y bases PostgreSQL separadas. El frontend Next.js ya usa un
adaptador HTTP real en el código; su publicación con los endpoints de la VM
requiere configurar y verificar el despliegue de Vercel.

## 2. Objetivos

### 2.1 Objetivo general

Documentar y hacer trazable la evolución del sistema satélite desde los flujos
de Práctica 7 hasta una arquitectura SOA con reserva asíncrona, persistencia y
despliegue reproducible en una VM de desarrollo.

### 2.2 Objetivos específicos

- Permitir la consulta de eventos académicos vinculados con cursos de YOUSAC.
- Procesar reservas de eventos con cupo limitado sin bloquear la respuesta HTTP.
- Separar formalmente productor, RabbitMQ y consumidor con confirmaciones y ACK.
- Permitir la consulta pública de la validez de una credencial digital.
- Mantener contratos HTTP, gRPC y Protocol Buffers para el frontend y los servicios.
- Mantener separadas las responsabilidades de talleres, reservas y
  certificados.
- Describir el despliegue físico en VM, el pipeline y los límites de la evidencia disponible.

## 3. Identidad y relación con YOUSAC

Academix Pass & CertiHub es un sistema satélite: comparte el contexto académico
de YOUSAC, pero tiene responsabilidades, flujos y servicios propios.

| Aspecto | YOUSAC | Academix Pass & CertiHub |
|---|---|---|
| Propósito | Consulta y reproducción de clases grabadas | Inscripción a eventos y verificación de credenciales |
| Unidad principal | Curso, clase y recurso académico | Evento, reserva, ticket y certificado |
| Flujo crítico | Reproducción de contenido | Reserva concurrente de cupos |
| Comunicación central | Servicios de YOUSAC | Servicios SOA y eventos mediante RabbitMQ |
| Frontend | Aplicación principal en Frontend/ | Aplicación independiente en Practica7/Frontend/ |

La documentación de esta práctica no modifica los servicios, contratos,
esquemas ni rutas del proyecto principal.

## 4. Alcance del sistema

### 4.1 Funcionalidades incluidas

#### Catálogo de eventos

El usuario podrá consultar eventos académicos publicados y relacionados con
cursos de YOUSAC. Cada evento deberá mostrar, como mínimo:

- Nombre y descripción.
- Curso relacionado.
- Ponente o responsable.
- Fecha y modalidad.
- Cupo total y cupos disponibles.
- Prerrequisitos.

#### Reserva asíncrona de cupo

El estudiante podrá seleccionar un evento e iniciar una solicitud de reserva
para participar en un taller, acreditación o examen de certificación. El
productor valida la entrada, publica una solicitud persistente en RabbitMQ y
responde `202 Accepted` con un `trackingId` después de la confirmación del
broker. El worker reclama cupo de forma atómica, persiste la resolución y
emite el pase cuando corresponde. El frontend consulta el estado después.

#### Verificación pública de credenciales

Una persona sin autenticación podrá ingresar un identificador único o hash de
un diploma y consultar si la credencial es válida, inválida o no encontrada.

#### Despliegue del frontend

El frontend independiente en `Practica7/Frontend/` usa Next.js con exportación
estática. El código de Práctica 8 consume los servicios HTTP reales mediante
`NEXT_PUBLIC_API_*`; los mocks de Práctica 7 permanecen como antecedente y
material de prueba, no como fuente de datos de las vistas actuales. La URL
pública de Vercel deberá reconstruirse con las variables de la VM antes de
considerar completa la integración de extremo a extremo.

### 4.2 Fuera del alcance de esta práctica

- Pantallas administrativas para crear, editar o publicar eventos.
- Integración con autenticación institucional de YOUSAC.
- Modificación de las rutas o componentes del frontend principal.
- Despliegue de esta malla SOA en Kubernetes de producción; el objetivo de
  Práctica 8 es la VM de desarrollo con Docker Compose.

La administración de eventos no forma parte de las pantallas de esta práctica.
La emisión y el registro de pases son internos al procesamiento de reservas;
la interfaz pública solo consulta y verifica credenciales.

## 5. Glosario del dominio

| Término | Definición |
|---|---|
| Evento | Actividad académica publicada y asociada a un curso o área de YOUSAC. |
| Cupo | Capacidad máxima de participantes permitidos para un evento. |
| Reserva | Solicitud de participación enviada por un estudiante para un evento. |
| Ticket | Comprobante simulado que identifica una reserva procesada. |
| Certificado | Diploma digital asociado con una actividad académica completada. |
| Hash de verificación | Identificador utilizado para consultar públicamente una credencial. |
| Broker | Componente que recibe y entrega mensajes asíncronos entre productores y consumidores. |
| Productor | Componente que publica una solicitud o evento en RabbitMQ. |
| Consumidor | Componente que procesa una solicitud recibida desde una cola. |
| Estado de reserva | Situación actual de una solicitud: pendiente, confirmada, rechazada o sin cupo. |

## 6. Actores

### 6.1 Estudiante

Consulta el catálogo, revisa los detalles de un evento, inicia una reserva y
consulta el ticket o estado resultante.

### 6.2 Verificador público

Accede al portal público e ingresa un identificador o hash para consultar la
validez de una credencial digital. No requiere autenticación.

### 6.3 Componentes internos

Los servicios de Talleres, Reservas/Ticketing y Certificados no son actores
humanos. Se documentan como componentes internos que colaboran para cumplir
los casos de uso del sistema.

## 7. Servicios del sistema

### 7.1 Servicio de Talleres

Responsabilidades:

- Persistir y consultar el catálogo de eventos en su propia base PostgreSQL.
- Exponer detalles del evento.
- Informar cupo total y disponibilidad; reclamar o liberar cupo de forma
  atómica mediante el contrato gRPC consumido por el worker.
- Informar prerrequisitos y curso relacionado.

### 7.2 Servicio de Reservas/Ticketing

Responsabilidades:

- Recibir la solicitud HTTP y validarla sintácticamente.
- Generar el `trackingId` y publicar en RabbitMQ con mensaje persistente y
  confirmación del broker antes de responder `202 Accepted`.
- Consultar desde Redis el estado de seguimiento. El productor **no** escribe
  directamente en PostgreSQL ni decide el cupo.
- Delegar al worker Python la validación de disponibilidad, la resolución y
  persistencia de la reserva y la emisión del pase.

### 7.3 Servicio de Certificados

Responsabilidades:

- Registrar en su propia base las credenciales emitidas por el worker mediante
  gRPC, con código y firma de validación.
- Mantener identificadores de verificación de los pases.
- Resolver consultas públicas por identificador o hash.
- Responder con el estado de la credencial y sus datos académicos mínimos.

## 8. Requerimientos del sistema

### 8.1 Requerimientos funcionales

La tabla RF-P7 preserva los criterios de la fase de mockups. Su referencia a
datos simulados documenta el alcance **original de Práctica 7**, no el estado
operativo del código de Práctica 8. Los requisitos nuevos se precisan en la
sección 17.

| ID | Nombre | Descripción | Prioridad | Criterio de aceptación | Caso de uso |
|---|---|---|---|---|---|
| RF-P7-01 | Consultar catálogo | El sistema debe mostrar los eventos académicos publicados y vinculados con cursos de YOUSAC. | Alta | El estudiante puede visualizar una lista de eventos usando datos del contrato mock de catálogo. | CU-P7-01 |
| RF-P7-02 | Consultar detalle del evento | El sistema debe mostrar nombre, descripción, ponente, fecha, modalidad, curso y prerrequisitos del evento seleccionado. | Alta | Al seleccionar un evento, se muestran todos los campos obligatorios definidos para el catálogo. | CU-P7-02 |
| RF-P7-03 | Consultar disponibilidad | El sistema debe mostrar el cupo total y los cupos disponibles de cada evento. | Alta | El detalle refleja el valor de disponibilidad entregado por el mock y distingue un evento sin cupo. | CU-P7-02 |
| RF-P7-04 | Solicitar reserva | El estudiante debe poder iniciar una solicitud de reserva para un evento disponible. | Alta | El formulario valida el evento y muestra confirmación de que la solicitud fue enviada. | CU-P7-03 |
| RF-P7-05 | Procesar ticket simulado | El sistema debe representar la emisión de un ticket después de que la solicitud sea procesada. | Alta | Una solicitud confirmada muestra un identificador de ticket y los datos básicos del evento. | CU-P7-04 |
| RF-P7-06 | Consultar estado de reserva | El estudiante debe poder consultar si su reserva está pendiente, confirmada, rechazada o sin cupo. | Alta | La interfaz muestra exactamente uno de los estados definidos y una explicación para el usuario. | CU-P7-04 |
| RF-P7-07 | Consultar credencial | El sistema debe permitir ingresar un identificador único o hash de un diploma desde una vista pública. | Alta | El verificador puede enviar una consulta sin autenticarse. | CU-P7-05 |
| RF-P7-08 | Mostrar resultado de verificación | El sistema debe informar si la credencial es válida, inválida o no encontrada. | Alta | Para cada respuesta del contrato mock se muestra un estado inequívoco y los datos académicos disponibles. | CU-P7-05 |

### 8.2 Requerimientos no funcionales

Los RNF-P7 también se conservan por trazabilidad histórica. En particular,
RNF-P7-06 (consumo de mocks) fue sustituido por el adaptador HTTP real y no
debe presentarse como requisito vigente de Práctica 8.

| ID | Nombre | Descripción cuantitativa | Prioridad | Criterio de aceptación | Caso de uso relacionado |
|---|---|---|---|---|---|
| RNF-P7-01 | Accesibilidad de evaluación | El 100% de los flujos principales deberá estar disponible mediante el dominio público de Vercel durante la evaluación. | Alta | Catálogo, reserva simulada y verificación se pueden abrir desde la URL pública sin depender de localhost. | CU-P7-01 a CU-P7-05 |
| RNF-P7-02 | Rendimiento percibido | El 95% de las respuestas de los mocks deberá reflejarse en la interfaz en un máximo de 2 segundos bajo condiciones normales de red. | Media | Las pantallas no quedan bloqueadas y muestran el resultado dentro del límite definido. | CU-P7-01 a CU-P7-05 |
| RNF-P7-03 | Diseño responsive | La interfaz deberá ser usable en al menos tres anchos: 360 px, 768 px y 1440 px. | Media | Las tres vistas principales conservan navegación y contenido legible en los tres anchos. | CU-P7-01 a CU-P7-05 |
| RNF-P7-04 | Estados de interacción | El 100% de las operaciones asíncronas deberá mostrar estado de carga, éxito y error. | Alta | Reserva y verificación tienen mensajes diferenciados para carga, respuesta correcta y fallo. | CU-P7-03 a CU-P7-05 |
| RNF-P7-05 | Seguridad del frontend | Se deberán mantener 0 secretos, credenciales o claves privadas dentro del código público o del repositorio documental. | Alta | La búsqueda pública solo utiliza datos de prueba y no expone credenciales reales. | CU-P7-05 |
| RNF-P7-06 | Contratos y mocks | El 100% de las operaciones del frontend deberá consumir interfaces mock documentadas. | Alta | Cada operación de catálogo, reserva y verificación tiene un contrato lógico asociado. | CU-P7-01 a CU-P7-05 |
| RNF-P7-07 | Trazabilidad | El 100% de los RF deberá relacionarse con al menos un caso de uso y un criterio de aceptación. | Media | La tabla de requisitos mantiene la columna de caso de uso y evidencia verificable. | CU-P7-01 a CU-P7-05 |

## 9. Casos de uso de la fase inicial (Práctica 7)

Estos casos de uso delimitan la primera versión de la documentación. Las
narrativas se presentan en formato académico y los diagramas UML
correspondientes se incluyen en la sección 9.6 junto con sus fuentes editables.

| ID | Caso de uso | Actor principal | Resultado esperado |
|---|---|---|---|
| CU-P7-01 | Consultar catálogo de eventos | Estudiante | El estudiante visualiza los eventos académicos publicados. |
| CU-P7-02 | Consultar detalle y disponibilidad | Estudiante | El estudiante conoce los datos del evento y sus cupos disponibles. |
| CU-P7-03 | Solicitar reserva de cupo | Estudiante | La solicitud queda registrada para su procesamiento asíncrono. |
| CU-P7-04 | Consultar ticket y estado de reserva | Estudiante | El estudiante visualiza el estado de la reserva y el ticket si fue confirmado. |
| CU-P7-05 | Verificar credencial digital | Verificador público | El sistema informa la validez de la credencial consultada. |

### Identificadores de alto nivel y módulos

El caso de uso de alto nivel y la primera descomposición utilizan identificadores
distintos de los cinco casos concretos para evitar confundir módulos con casos de
uso ejecutados directamente por el usuario.

| Nivel | Identificador | Nombre | Casos concretos relacionados |
|---|---|---|---|
| Alto nivel | CU-P7-00 | Consultar eventos, solicitar reservas y verificar credenciales digitales | CU-P7-01 a CU-P7-05 |
| Módulo | M-P7-01 | Catálogo de eventos | CU-P7-01, CU-P7-02 |
| Módulo | M-P7-02 | Reservas y Ticketing | CU-P7-03, CU-P7-04 |
| Módulo | M-P7-03 | Verificación de credenciales | CU-P7-05 |

### CU-P7-01: Consultar catálogo de eventos

| Campo | Descripción |
|---|---|
| ID | CU-P7-01 |
| Nombre | Consultar catálogo de eventos |
| Actor principal | Estudiante |
| Descripción | Permite al estudiante consultar los eventos académicos publicados por el Servicio de Talleres. |
| Precondiciones | El frontend está disponible y el contrato de catálogo puede ser consultado. |
| Postcondiciones | Se muestra una lista de eventos con sus datos principales o un estado vacío si no existen eventos publicados. |
| Requerimientos relacionados | RF-P7-01 |
| Servicios y componentes participantes | Frontend independiente, Servicio de Talleres y contrato mock GET /mock/events. |

**Flujo principal:**

| Paso | Actor o componente | Acción |
|---|---|---|
| 1 | Estudiante | Accede a la vista de catálogo de Academix Pass & CertiHub. |
| 2 | Frontend | Solicita al contrato de catálogo la lista de eventos publicados. |
| 3 | Servicio de Talleres | Retorna los eventos disponibles con sus datos resumidos. |
| 4 | Frontend | Valida que cada evento tenga identificador, nombre, curso, ponente, fecha y disponibilidad. |
| 5 | Frontend | Muestra las tarjetas o filas de los eventos publicados. |
| 6 | Estudiante | Selecciona un evento para consultar su información completa mediante CU-P7-02. |

**Flujos alternativos:**

| ID | Condición | Acción |
|---|---|---|
| FA-01 | No existen eventos publicados | El frontend muestra un estado vacío con un mensaje informativo y conserva disponible la navegación del sistema. |
| FA-02 | Un evento no tiene cupos disponibles | El evento permanece visible, pero se identifica como SIN_CUPO para que el estudiante conozca su disponibilidad antes de abrir el detalle. |

**Flujos de excepción:**

| ID | Condición | Acción |
|---|---|---|
| FE-01 | El contrato de catálogo no responde | El frontend muestra un mensaje de error y ofrece reintentar la consulta. |
| FE-02 | La respuesta contiene datos incompletos o inválidos | El frontend no muestra información inconsistente, registra el estado de error de la consulta y solicita reintentar. |

**Reglas de negocio:**

- Solo se muestran eventos marcados como publicados.
- La cantidad de cupos disponibles no puede ser negativa ni superar el cupo total.
- La consulta del catálogo no inicia una reserva.

### CU-P7-02: Consultar detalle y disponibilidad

| Campo | Descripción |
|---|---|
| ID | CU-P7-02 |
| Nombre | Consultar detalle y disponibilidad |
| Actor principal | Estudiante |
| Descripción | Permite consultar la información completa de un evento y determinar si puede iniciar una reserva. |
| Precondiciones | El estudiante seleccionó un evento del catálogo y se dispone de su identificador. |
| Postcondiciones | Se muestran los datos completos del evento, sus prerrequisitos y el estado del botón de reserva. |
| Requerimientos relacionados | RF-P7-02, RF-P7-03 |
| Servicios y componentes participantes | Frontend independiente, Servicio de Talleres y contrato mock GET /mock/events/{eventId}. |

**Flujo principal:**

| Paso | Actor o componente | Acción |
|---|---|---|
| 1 | Estudiante | Selecciona un evento desde el catálogo. |
| 2 | Frontend | Solicita el detalle utilizando el identificador del evento. |
| 3 | Servicio de Talleres | Retorna nombre, descripción, curso, ponente, fecha, modalidad, cupo y prerrequisitos. |
| 4 | Frontend | Valida y presenta la información completa del evento. |
| 5 | Frontend | Calcula visualmente si existen cupos disponibles para iniciar una reserva. |
| 6 | Estudiante | Revisa los prerrequisitos y decide iniciar la reserva o regresar al catálogo. |
| 7 | Frontend | Habilita la acción de reserva cuando el evento tiene disponibilidad y dirige a CU-P7-03. |

**Flujos alternativos:**

| ID | Condición | Acción |
|---|---|---|
| FA-01 | El evento no tiene cupos disponibles | El frontend muestra SIN_CUPO, deshabilita la acción de reserva y permite volver al catálogo. |
| FA-02 | El evento no declara prerrequisitos | El frontend muestra que no existen prerrequisitos registrados y mantiene disponible la acción de reserva si hay cupo. |
| FA-03 | El estudiante decide no continuar | El frontend conserva el detalle consultado y permite regresar al catálogo sin crear una reserva. |

**Flujos de excepción:**

| ID | Condición | Acción |
|---|---|---|
| FE-01 | El identificador no corresponde a un evento | El frontend muestra que el evento no fue encontrado y ofrece regresar al catálogo. |
| FE-02 | El Servicio de Talleres no está disponible | El frontend muestra un error de consulta y ofrece reintentar. |

**Reglas de negocio:**

- Un evento sin cupos no puede iniciar una reserva.
- Los prerrequisitos se muestran como información del evento; la validación productiva de elegibilidad queda fuera de esta primera entrega.
- La disponibilidad mostrada proviene del contrato de catálogo o del mock documentado.

### CU-P7-03: Solicitar reserva de cupo

| Campo | Descripción |
|---|---|
| ID | CU-P7-03 |
| Nombre | Solicitar reserva de cupo |
| Actor principal | Estudiante |
| Descripción | Permite enviar una solicitud de reserva para un evento disponible, registrarla en estado PENDIENTE y dejarla lista para procesamiento asíncrono. |
| Precondiciones | El estudiante consultó un evento disponible, cuenta con una identidad de prueba y no existe una solicitud confirmada duplicada para el mismo evento. |
| Postcondiciones | Se genera un identificador de reserva y la solicitud queda inicialmente en estado PENDIENTE; todavía no se emite un ticket confirmado. |
| Requerimientos relacionados | RF-P7-04 |
| Servicios y componentes participantes | Frontend independiente, Servicio de Talleres, Servicio de Reservas/Ticketing, RabbitMQ, consumidor de reservas y contrato mock POST /mock/reservations. |

**Flujo principal:**

| Paso | Actor o componente | Acción |
|---|---|---|
| 1 | Estudiante | Selecciona la acción de reservar desde el detalle de un evento disponible. |
| 2 | Frontend | Solicita o confirma los datos mínimos de la reserva y muestra un resumen del evento. |
| 3 | Estudiante | Confirma el envío de la solicitud. |
| 4 | Frontend | Envía eventId y los datos mínimos del estudiante al Servicio de Reservas/Ticketing. |
| 5 | Servicio de Reservas/Ticketing | Valida que el evento exista y que la solicitud tenga los datos requeridos. |
| 6 | Servicio de Reservas/Ticketing | Crea la solicitud con identificador propio y estado PENDIENTE. |
| 7 | Servicio de Reservas/Ticketing | Publica el evento de reserva solicitada en RabbitMQ para su procesamiento interno. |
| 8 | Consumidor de reservas | Recibe el mensaje, valida capacidad y reglas de negocio, y comunica el resultado al Servicio de Reservas/Ticketing. |
| 9 | Frontend | Muestra el identificador de reserva y el estado inicial PENDIENTE, dirigiendo a CU-P7-04 para consultar el resultado. |

**Flujos alternativos:**

| ID | Condición | Acción |
|---|---|---|
| FA-01 | El evento pierde disponibilidad antes de publicar la solicitud | El Servicio de Reservas/Ticketing rechaza la operación con estado SIN_CUPO y no genera ticket. |
| FA-02 | El estudiante no cumple un prerrequisito requerido | El consumidor procesa la regla y actualiza la solicitud a RECHAZADA, mostrando el motivo al estudiante. |
| FA-03 | Ya existe una solicitud del mismo estudiante para el evento | El servicio devuelve la reserva existente y evita publicar una solicitud duplicada. |

**Flujos de excepción:**

| ID | Condición | Acción |
|---|---|---|
| FE-01 | Faltan datos obligatorios o el evento no es válido | El frontend impide el envío, muestra los campos que deben corregirse y no crea una reserva. |
| FE-02 | El Servicio de Reservas/Ticketing no está disponible | El frontend informa que la solicitud no pudo enviarse y permite reintentar sin mostrar una reserva confirmada. |
| FE-03 | RabbitMQ no acepta el mensaje | La solicitud no se presenta como confirmada; el servicio informa el fallo de procesamiento y permite reintentar según el contrato definido. |

**Reglas de negocio:**

- El frontend no se conecta directamente con RabbitMQ.
- CU-P7-03 concluye para el frontend cuando la solicitud tiene identificador y estado PENDIENTE; el resultado final se consulta mediante CU-P7-04.
- Una solicitud PENDIENTE no genera un ticket confirmado.
- La verificación definitiva de cupo se realiza durante el procesamiento interno.
- El procesamiento debe ser idempotente para evitar más de una reserva confirmada por estudiante y evento.

### CU-P7-04: Consultar ticket y estado de reserva

| Campo | Descripción |
|---|---|
| ID | CU-P7-04 |
| Nombre | Consultar ticket y estado de reserva |
| Actor principal | Estudiante |
| Descripción | Permite consultar el resultado actualizado de una solicitud de reserva y visualizar el ticket cuando corresponda. |
| Precondiciones | El estudiante posee un identificador de reserva obtenido durante CU-P7-03 o una reserva de prueba válida. |
| Postcondiciones | Se muestra el estado actual de la reserva, el motivo cuando corresponda y el ticket si la reserva fue confirmada. |
| Requerimientos relacionados | RF-P7-05, RF-P7-06 |
| Servicios y componentes participantes | Frontend independiente, Servicio de Reservas/Ticketing, consumidor de reservas y contrato mock GET /mock/reservations/{reservationId}. |

**Flujo principal:**

| Paso | Actor o componente | Acción |
|---|---|---|
| 1 | Estudiante | Accede a la consulta de reserva e ingresa el identificador recibido. |
| 2 | Frontend | Valida que el identificador tenga un formato permitido. |
| 3 | Frontend | Solicita el estado al Servicio de Reservas/Ticketing. |
| 4 | Servicio de Reservas/Ticketing | Retorna el estado actual, mensaje y ticket cuando exista. |
| 5 | Frontend | Interpreta el estado y muestra la información correspondiente. |
| 6 | Estudiante | Consulta nuevamente cuando la reserva permanece PENDIENTE o revisa el ticket cuando está CONFIRMADA. |

**Flujos alternativos:**

| ID | Condición | Acción |
|---|---|---|
| FA-01 | La reserva está PENDIENTE | El frontend muestra que el procesamiento continúa y permite actualizar la consulta. |
| FA-02 | La reserva está CONFIRMADA | El frontend muestra los datos del evento, el identificador del ticket y las instrucciones disponibles. |
| FA-03 | La reserva está RECHAZADA | El frontend muestra el estado y el motivo informado por el servicio; no presenta ticket. |
| FA-04 | La reserva está SIN_CUPO | El frontend informa que no se pudo asignar cupo y no presenta ticket confirmado. |

**Flujos de excepción:**

| ID | Condición | Acción |
|---|---|---|
| FE-01 | El identificador no corresponde a una reserva | El frontend muestra que la reserva no fue encontrada y solicita verificar el dato. |
| FE-02 | El Servicio de Reservas/Ticketing no responde | El frontend muestra un error temporal y permite reintentar la consulta. |
| FE-03 | La respuesta no contiene un estado válido | El frontend evita mostrar un resultado ambiguo y presenta un error de procesamiento. |

**Reglas de negocio:**

- Los estados válidos son PENDIENTE, CONFIRMADA, RECHAZADA y SIN_CUPO.
- Solo una reserva CONFIRMADA puede mostrar un ticket.
- Una reserva en estado terminal no debe cambiar a otro estado sin una operación administrativa definida en una fase posterior.
- La consulta del estado no publica nuevos mensajes en RabbitMQ; consulta el resultado producido por el procesamiento interno.

### CU-P7-05: Verificar credencial digital

| Campo | Descripción |
|---|---|
| ID | CU-P7-05 |
| Nombre | Verificar credencial digital |
| Actor principal | Verificador público |
| Descripción | Permite consultar públicamente la validez académica de un diploma mediante su identificador único o hash. |
| Precondiciones | El portal público está disponible y el verificador cuenta con un identificador o hash para consultar. |
| Postcondiciones | Se muestra el estado de la credencial y únicamente los datos académicos disponibles para verificación pública. |
| Requerimientos relacionados | RF-P7-07, RF-P7-08 |
| Servicios y componentes participantes | Frontend independiente, Servicio de Certificados y contrato mock GET /mock/credentials/verify. |

**Flujo principal:**

| Paso | Actor o componente | Acción |
|---|---|---|
| 1 | Verificador público | Accede al portal de verificación sin autenticarse. |
| 2 | Verificador público | Ingresa el identificador único o hash del diploma. |
| 3 | Frontend | Valida que el campo no esté vacío y normaliza el valor ingresado. |
| 4 | Frontend | Envía la consulta al Servicio de Certificados. |
| 5 | Servicio de Certificados | Busca la credencial asociada con el identificador recibido. |
| 6 | Servicio de Certificados | Retorna el estado de verificación y los datos públicos disponibles. |
| 7 | Frontend | Muestra el resultado de manera clara, indicando si la credencial es válida, inválida o no encontrada. |

**Flujos alternativos:**

| ID | Condición | Acción |
|---|---|---|
| FA-01 | La credencial es VÁLIDA | El frontend muestra el estado válido, el nombre de la actividad y los datos académicos autorizados. |
| FA-02 | La credencial es INVÁLIDA | El frontend muestra el estado inválido sin exponer datos internos del certificado. |
| FA-03 | La credencial es NO_ENCONTRADA | El frontend informa que no existe una credencial asociada con el valor consultado. |

**Flujos de excepción:**

| ID | Condición | Acción |
|---|---|---|
| FE-01 | El campo está vacío o tiene un formato no permitido | El frontend solicita un identificador válido y no envía la consulta. |
| FE-02 | El Servicio de Certificados no está disponible | El frontend muestra un error temporal y permite reintentar. |
| FE-03 | La respuesta no contiene un estado de verificación válido | El frontend muestra un error de procesamiento y no declara la credencial como válida. |

**Reglas de negocio:**

- La verificación pública no requiere autenticación.
- Los estados válidos son VÁLIDA, INVÁLIDA y NO_ENCONTRADA.
- La consulta solo devuelve los datos definidos como públicos.
- Este caso de uso verifica credenciales; no emite ni modifica certificados.

### 9.6 Diagramas de casos de uso

Los siguientes diagramas representan el alcance de la Práctica 7 y mantienen
separada esta solución satélite del proyecto principal YOUSAC. Cada imagen SVG
se acompaña de su fuente editable en formato `.drawio`.

#### Diagrama de alto nivel

[![Diagrama de alto nivel de YOUSAC Academix Pass & CertiHub](CDU/CDU_AltoNivel_P7_202307691.drawio.svg)](CDU/CDU_AltoNivel_P7_202307691.drawio)

[Fuente editable del diagrama de alto nivel](CDU/CDU_AltoNivel_P7_202307691.drawio)

#### Primera descomposición

[![Primera descomposición de YOUSAC Academix Pass & CertiHub](CDU/CDU_PrimeraDescomposicion_P7_202307691.drawio.svg)](CDU/CDU_PrimeraDescomposicion_P7_202307691.drawio)

[Fuente editable de la primera descomposición](CDU/CDU_PrimeraDescomposicion_P7_202307691.drawio)

#### Casos de uso expandidos

##### CU-P7-01 — Consultar catálogo de eventos

[![Diagrama expandido del CU-P7-01](CDU/CDU_Expandido_CUP7_01_202307691.drawio.svg)](CDU/CDU_Expandido_CUP7_01_202307691.drawio)

[Fuente editable del CU-P7-01](CDU/CDU_Expandido_CUP7_01_202307691.drawio)

##### CU-P7-02 — Consultar detalle y disponibilidad

[![Diagrama expandido del CU-P7-02](CDU/CDU_Expandido_CUP7_02_202307691.drawio.svg)](CDU/CDU_Expandido_CUP7_02_202307691.drawio)

[Fuente editable del CU-P7-02](CDU/CDU_Expandido_CUP7_02_202307691.drawio)

##### CU-P7-03 — Solicitar reserva de cupo

[![Diagrama expandido del CU-P7-03](CDU/CDU_Expandido_CUP7_03_202307691.drawio.svg)](CDU/CDU_Expandido_CUP7_03_202307691.drawio)

[Fuente editable del CU-P7-03](CDU/CDU_Expandido_CUP7_03_202307691.drawio)

##### CU-P7-04 — Consultar ticket y estado de reserva

[![Diagrama expandido del CU-P7-04](CDU/CDU_Expandido_CUP7_04_202307691.drawio.svg)](CDU/CDU_Expandido_CUP7_04_202307691.drawio)

[Fuente editable del CU-P7-04](CDU/CDU_Expandido_CUP7_04_202307691.drawio)

##### CU-P7-05 — Verificar credencial digital

[![Diagrama expandido del CU-P7-05](CDU/CDU_Expandido_CUP7_05_202307691.drawio.svg)](CDU/CDU_Expandido_CUP7_05_202307691.drawio)

[Fuente editable del CU-P7-05](CDU/CDU_Expandido_CUP7_05_202307691.drawio)

## 10. Mockups UI/UX de Práctica 7

Los mockups de **Academix Pass & CertiHub** documentan la interfaz del
frontend independiente de Práctica 7. Mantienen el estilo wireframe de los
mockups de YOUSAC: fondo claro, bordes delgados, controles azul claro y datos de
prueba identificados como mock. No representan pantallas de autenticación,
administración, emisión de certificados ni una conexión directa del frontend
con RabbitMQ.

El archivo editable maestro se encuentra en
[AcademixPass_CertiHub_P7_Mockups.pen](Mockups/AcademixPass_CertiHub_P7_Mockups.pen).
La implementación de la interfaz se encuentra en
[Practica7/Frontend](../../Frontend/README.md), separada del frontend
principal de YOUSAC.
Las exportaciones PNG corresponden a los frames principales del documento
Pencil y a las hojas de estados alternativos.

### 10.1 Matriz de trazabilidad

| Vista | Caso(s) de uso | Requerimiento(s) funcional(es) | Contrato mock | Estados representados |
|---|---|---|---|---|
| Catálogo de eventos | CU-P7-01 | RF-P7-01 | `GET /mock/events` | Cargado, vacío, error y `SIN_CUPO` |
| Detalle del evento | CU-P7-02 | RF-P7-02, RF-P7-03 | `GET /mock/events/{eventId}` | Disponible, sin cupo, no encontrado y error |
| Solicitud de reserva | CU-P7-03 | RF-P7-04 | `POST /mock/reservations` | Validación, `PENDIENTE`, duplicada, prerrequisito, `SIN_CUPO` y error |
| Estado de reserva | CU-P7-04 | RF-P7-05, RF-P7-06 | `GET /mock/reservations/{reservationId}` | `PENDIENTE`, `CONFIRMADA` con ticket, `RECHAZADA`, `SIN_CUPO`, no encontrada y error |
| Verificación de credencial | CU-P7-05 | RF-P7-07, RF-P7-08 | `GET /mock/credentials/verify?identifier=` | `VÁLIDA`, `INVÁLIDA`, `NO_ENCONTRADA`, formato inválido y error |

Las cinco vistas tienen variantes responsive de 360 px, 768 px y 1440 px,
conforme a RNF-P7-03. Las hojas de estados reúnen las respuestas de carga,
vacío, validación, éxito y error necesarias para revisar RNF-P7-04 sin duplicar
innecesariamente cada variante en los tres anchos.

### 10.2 Vistas principales responsive

#### Catálogo de eventos — CU-P7-01

[![Catálogo a 360 px](Mockups/Mockup_Catalogo_P7_202307691_360.png)](Mockups/Mockup_Catalogo_P7_202307691_360.png)

[![Catálogo a 768 px](Mockups/Mockup_Catalogo_P7_202307691_768.png)](Mockups/Mockup_Catalogo_P7_202307691_768.png)

[![Catálogo a 1440 px](Mockups/Mockup_Catalogo_P7_202307691_1440.png)](Mockups/Mockup_Catalogo_P7_202307691_1440.png)

#### Detalle del evento — CU-P7-02

[![Detalle del evento a 360 px](Mockups/Mockup_DetalleEvento_P7_202307691_360.png)](Mockups/Mockup_DetalleEvento_P7_202307691_360.png)

[![Detalle del evento a 768 px](Mockups/Mockup_DetalleEvento_P7_202307691_768.png)](Mockups/Mockup_DetalleEvento_P7_202307691_768.png)

[![Detalle del evento a 1440 px](Mockups/Mockup_DetalleEvento_P7_202307691_1440.png)](Mockups/Mockup_DetalleEvento_P7_202307691_1440.png)

#### Solicitud de reserva — CU-P7-03

[![Solicitud de reserva a 360 px](Mockups/Mockup_Reserva_P7_202307691_360.png)](Mockups/Mockup_Reserva_P7_202307691_360.png)

[![Solicitud de reserva a 768 px](Mockups/Mockup_Reserva_P7_202307691_768.png)](Mockups/Mockup_Reserva_P7_202307691_768.png)

[![Solicitud de reserva a 1440 px](Mockups/Mockup_Reserva_P7_202307691_1440.png)](Mockups/Mockup_Reserva_P7_202307691_1440.png)

#### Estado de reserva — CU-P7-04

[![Estado de reserva a 360 px](Mockups/Mockup_EstadoReserva_P7_202307691_360.png)](Mockups/Mockup_EstadoReserva_P7_202307691_360.png)

[![Estado de reserva a 768 px](Mockups/Mockup_EstadoReserva_P7_202307691_768.png)](Mockups/Mockup_EstadoReserva_P7_202307691_768.png)

[![Estado de reserva a 1440 px](Mockups/Mockup_EstadoReserva_P7_202307691_1440.png)](Mockups/Mockup_EstadoReserva_P7_202307691_1440.png)

#### Verificación de credencial — CU-P7-05

[![Verificación de credencial a 360 px](Mockups/Mockup_VerificacionCredencial_P7_202307691_360.png)](Mockups/Mockup_VerificacionCredencial_P7_202307691_360.png)

[![Verificación de credencial a 768 px](Mockups/Mockup_VerificacionCredencial_P7_202307691_768.png)](Mockups/Mockup_VerificacionCredencial_P7_202307691_768.png)

[![Verificación de credencial a 1440 px](Mockups/Mockup_VerificacionCredencial_P7_202307691_1440.png)](Mockups/Mockup_VerificacionCredencial_P7_202307691_1440.png)

### 10.3 Hojas de estados alternativos

Las siguientes hojas reúnen los estados secundarios utilizados por las
narrativas de los casos de uso. Los textos y valores son datos de prueba.

#### Estados del catálogo

[![Estados del catálogo](Mockups/Estados_Catalogo_P7_202307691.png)](Mockups/Estados_Catalogo_P7_202307691.png)

#### Estados del detalle del evento

[![Estados del detalle del evento](Mockups/Estados_DetalleEvento_P7_202307691.png)](Mockups/Estados_DetalleEvento_P7_202307691.png)

#### Estados de la solicitud de reserva

[![Estados de la solicitud de reserva](Mockups/Estados_Reserva_P7_202307691.png)](Mockups/Estados_Reserva_P7_202307691.png)

#### Estados de la consulta de reserva

[![Estados de la consulta de reserva](Mockups/Estados_EstadoReserva_P7_202307691.png)](Mockups/Estados_EstadoReserva_P7_202307691.png)

#### Estados de la verificación de credencial

[![Estados de la verificación de credencial](Mockups/Estados_VerificacionCredencial_P7_202307691.png)](Mockups/Estados_VerificacionCredencial_P7_202307691.png)

## 11. Estados del dominio

### 11.1 Estados de una reserva

| Estado | Descripción |
|---|---|
| PENDIENTE | La solicitud fue recibida y espera procesamiento. |
| CONFIRMADA | La reserva fue aceptada y existe un ticket asociado. |
| RECHAZADA | La solicitud no fue aceptada por una regla de negocio. |
| SIN_CUPO | La solicitud no pudo confirmarse porque el evento alcanzó su capacidad. |

### 11.2 Estados de verificación

| Estado | Descripción |
|---|---|
| VÁLIDA | El identificador corresponde a una credencial emitida y vigente. |
| INVÁLIDA | La credencial existe, pero no cumple las condiciones de validez. |
| NO_ENCONTRADA | No existe una credencial asociada con el identificador consultado. |

## 12. Flujo de reserva implementado

El frontend no se conecta directamente con RabbitMQ. Envía la solicitud HTTP
al productor Go, que valida la entrada, genera un `trackingId` y publica un
mensaje Protocol Buffers persistente. Solo tras recibir la confirmación de
RabbitMQ responde `202 Accepted` con estado `PENDIENTE`; **202 no significa
que ya exista una reserva confirmada**. Una solicitud inválida o una
publicación fallida no recibe ese 202.

El worker Python consume la cola durable, reclama cupo mediante gRPC al
servicio de Catálogo, persiste la resolución en PostgreSQL de Reservas y,
cuando corresponde, registra la credencial en Certificados mediante gRPC.
Actualiza Redis para el seguimiento y emite ACK manual al terminar. Ante una
excepción transitoria hace NACK con reencolado. El frontend consulta después
el estado por `trackingId`; la sección 18 contiene el diagrama de secuencia
detallado, incluidos los caminos alternos.

El registro de la credencial en Certificados se intenta después de persistir
la reserva. Si esa llamada gRPC falla, el worker registra el error y conserva
la reserva como confirmada; la verificación pública de ese pase requiere
reconciliación posterior. No se presenta esa operación como una transacción
atómica entre bases de datos.

La resolución por `trackingId` es idempotente en la persistencia de reservas:
una entrega duplicada no debe generar dos reservas confirmadas. Si falla la
escritura tras reclamar cupo, el worker intenta liberar ese cupo antes de
reintentar el mensaje.

## 13. Contratos HTTP actuales y mocks históricos

Los siguientes contratos `/mock/*` son la especificación **histórica** usada
para los mockups de Práctica 7. No son los endpoints del backend actual.

| Operación | Entrada | Respuesta mínima |
|---|---|---|
| GET /mock/events | Filtros opcionales del catálogo | Lista de eventos con disponibilidad y prerrequisitos. |
| GET /mock/events/{eventId} | Identificador del evento | Detalle completo del evento y sus cupos. |
| POST /mock/reservations | eventId y datos mínimos del estudiante | reservationId y estado inicial PENDIENTE. |
| GET /mock/reservations/{reservationId} | Identificador de reserva | Estado, mensaje y ticket cuando exista. |
| GET /mock/credentials/verify?identifier= | Identificador o hash | Estado de verificación y datos académicos disponibles. |

### 13.1 Implementación mock de Práctica 7

El frontend de la fase inicial consumía adaptadores locales equivalentes a las
operaciones anteriores. Las interfaces TypeScript principales eran
`listEvents`, `getEvent`, `createReservation`, `getReservation` y
`verifyCredential`. En el código vigente esas mismas operaciones usan el
adaptador HTTP `Practica7/Frontend/lib/api/academix-api.ts`.

Los identificadores de demostración disponibles son:

| Escenario | Identificador o valor |
|---|---|
| Evento disponible | `evt-soa` |
| Evento sin cupo | `evt-cert` |
| Catálogo vacío | `/?scenario=empty` |
| Error de catálogo | `/?scenario=error` |
| Reserva pendiente | `RSV-2026-000184` |
| Reserva confirmada con ticket | `RSV-2026-000185` |
| Reserva rechazada | `RSV-2026-000186` |
| Reserva sin cupo | `RSV-2026-000187` |
| Credencial válida | `CERT-2026-000742` |
| Credencial inválida | `CERT-INVALIDA-2026` |
| Credencial no encontrada | `CERT-NO-ENCONTRADA` |
| Error de credencial | `CERT-ERROR` |

En la versión mock de Práctica 7, las reservas de prueba se guardaban en el
`localStorage` del navegador; esto ya no describe el flujo real de Práctica 8.

Los mocks contemplan al menos:

- Evento con cupos disponibles.
- Evento sin cupo.
- Reserva pendiente.
- Reserva confirmada con ticket.
- Reserva rechazada.
- Credencial válida.
- Credencial inválida.
- Credencial no encontrada.
- Error de comunicación.

### 13.2 Endpoints de Práctica 8

| Servicio | Operación HTTP pública | Resultado |
|---|---|---|
| Catálogo | `GET /catalogo/api/talleres/eventos` y `GET /catalogo/api/talleres/eventos/{id}` | Lista, detalle y disponibilidad de talleres. |
| Reservas | `POST /reservas/api/reservas` | `202 Accepted`, `trackingId` y `PENDIENTE` tras confirmación del broker. |
| Reservas | `GET /reservas/api/reservas/{trackingId}/estado` | Estado final o `PENDIENTE` si el worker aún no resuelve. |
| Certificados | `GET /certificados/api/certificados/verificar` | Resultado público de la verificación. |

Las rutas con prefijos `/catalogo`, `/reservas` y `/certificados` corresponden
al proxy HTTPS Caddy de la VM. Internamente, los servicios exponen `/api/...`
y el worker usa gRPC para reclamar cupos y registrar credenciales. Las bases
URL se inyectan en el build del frontend mediante las variables públicas
`NEXT_PUBLIC_API_CATALOGO_BASE`, `NEXT_PUBLIC_API_RESERVAS_BASE` y
`NEXT_PUBLIC_API_CERTIFICADOS_BASE`. Nunca deben contener secretos.

## 14. Supuestos y decisiones

### 14.1 Matriz de decisiones técnicas

La matriz conserva el criterio **qué / por qué / para qué** de la fase inicial,
actualizado conforme a la implementación de Práctica 8. La matriz SOLID de
productor y consumidor, distinta de esta selección tecnológica, está en la
sección 20.

| Qué | Por qué | Para qué |
|---|---|---|
| SOA con Catálogo, Reservas, worker y Certificados separados. | Cada responsabilidad evoluciona sin obligar al productor a conocer la base de datos o la lógica de cupos. | Atender catálogo, aceptación rápida, procesamiento y verificación con límites explícitos. |
| RabbitMQ con cola durable y ACK manual. | La demanda de cupos puede llegar en picos y la persistencia puede tardar; el broker desacopla recepción y resolución. | Mantener solicitudes pendientes mientras el worker está caído y reintentarlas sin responder tarde al usuario. |
| Redis para seguimiento y caché. | Las lecturas repetidas del estado no necesitan consultar la base de reservas. | Mostrar `PENDIENTE` y el resultado final al frontend por `trackingId`. |
| PostgreSQL separado por dominio. | Evita una base compartida escrita por todos los servicios y facilita transacciones locales de cupo. | Persistir catálogo, reservas y credenciales en sus respectivos servicios. |
| Vercel para el frontend Next.js; VM con Docker Compose para backend. | Separa el cliente estático del procesamiento y permite reconstruir la VM con imágenes versionadas. | Exponer la interfaz y las APIs públicas de desarrollo sin evaluar en localhost. |

### 14.2 Decisiones adoptadas

| Decisión | Justificación |
|---|---|
| Sistema satélite separado | El dominio de reservas y credenciales no se incorpora como un módulo de los servicios actuales de YOUSAC. |
| Evolución en la misma carpeta | Se actualiza `Documentacion/Practica7/DocumentoTecnico_Practica7.md` para preservar la trazabilidad y añadir Práctica 8. |
| Productor sin escritura SQL | El servicio Go solo valida, publica y consulta el seguimiento; las transacciones de cupo pertenecen a Catálogo y la resolución de reservas al worker. |
| Contratos tipados | Protocol Buffers y gRPC definen la comunicación interna; HTTP sirve al navegador. |
| Frontend independiente | La aplicación de `Practica7/Frontend/` no agrega rutas al frontend principal de YOUSAC. |

### 14.3 Supuestos

- Los eventos del catálogo se crean por mecanismos internos; no existe una
  pantalla administrativa para publicarlos en esta práctica.
- La autenticación institucional de YOUSAC no forma parte de la integración.
- La VM de desarrollo tiene una IP que puede cambiar; el proxy, CORS y las
  variables de Vercel deben actualizarse conjuntamente si eso ocurre.
- La presencia de manifiestos, pipeline y diagramas en Git no demuestra por sí
  misma que el sitio Vercel ya consuma el backend real.

### 14.4 Límite de la evidencia

Este documento describe el código y la topología previstos en el repositorio.
El estado exacto del despliegue en GHCR, VM y Vercel se demuestra con enlaces,
ejecuciones del pipeline y pruebas desde Internet; las instrucciones para esa
verificación se encuentran en la sección 21.

## 15. Diagrama Entidad Relación

![ER](ER/ER_Practica7_G4.drawio.svg)

## 16. Vista 4+1

El siguiente diagrama reúne las cinco perspectivas de la Práctica 7: los casos
de uso como vista de escenarios (+1), la lógica de los servicios, el proceso
asíncrono de reserva, los componentes de desarrollo y el despliegue físico.
Se conserva como **línea base histórica** de la fase de diseño: no sustituye
los diagramas de implementación de Práctica 8 de las secciones 18 y 19.
Cada perspectiva se detalla en los diagramas de esta sección y en los casos de
uso de la sección 9.6.

![Vista 4+1 de la Práctica 7](Vistas4+1/Vista4+1_Practica7_G4.drawio.svg)

[Fuente editable de la vista 4+1](Vistas4+1/XML/Vista4+1_Practica7_G4.drawio)

### Vista Lógica

La vista lógica se entrega como una secuencia consolidada y como una secuencia
específica para cada caso de uso, siguiendo el formato utilizado en las fases
anteriores. Esta vista describe las responsabilidades de los servicios y el
retorno de estados; el detalle del broker RabbitMQ se reserva para la vista de
procesos, donde se muestra el productor, la cola y el consumidor.

![Vista lógica consolidada](Vistas4+1/VistaLogica_DiagramaSecuencia_P7_G4.drawio.svg)

[Fuente editable de la vista lógica consolidada](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_P7_G4.drawio)

#### Vistas lógicas por caso de uso

##### CU-P7-01 — Consultar catálogo de eventos

![Vista lógica CU-P7-01](Vistas4+1/VistaLogica_DiagramaSecuencia_CUP7_01_P7_G4.drawio.svg)

[Fuente editable CU-P7-01](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_CUP7_01_P7_G4.drawio)

##### CU-P7-02 — Consultar detalle y disponibilidad

![Vista lógica CU-P7-02](Vistas4+1/VistaLogica_DiagramaSecuencia_CUP7_02_P7_G4.drawio.svg)

[Fuente editable CU-P7-02](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_CUP7_02_P7_G4.drawio)

##### CU-P7-03 — Solicitar reserva de cupo

![Vista lógica CU-P7-03](Vistas4+1/VistaLogica_DiagramaSecuencia_CUP7_03_P7_G4.drawio.svg)

[Fuente editable CU-P7-03](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_CUP7_03_P7_G4.drawio)

##### CU-P7-04 — Consultar ticket y estado de reserva

![Vista lógica CU-P7-04](Vistas4+1/VistaLogica_DiagramaSecuencia_CUP7_04_P7_G4.drawio.svg)

[Fuente editable CU-P7-04](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_CUP7_04_P7_G4.drawio)

##### CU-P7-05 — Verificar credencial digital

![Vista lógica CU-P7-05](Vistas4+1/VistaLogica_DiagramaSecuencia_CUP7_05_P7_G4.drawio.svg)

[Fuente editable CU-P7-05](Vistas4+1/XML/VistaLogica_DiagramaSecuencia_CUP7_05_P7_G4.drawio)

### Vista de Procesos

La vista de procesos se entrega como un flujo consolidado y como un diagrama
de actividades por cada caso de uso. El flujo de reserva representa
explícitamente productor → RabbitMQ → consumidor, con respuesta inicial
`PENDIENTE` y resolución posterior `CONFIRMADA`, `RECHAZADA` o `SIN_CUPO`.

![Vista de procesos consolidada](Vistas4+1/VistaProcesos_DiagramaActividades_P7_G4.drawio.svg)

[Fuente editable de la vista de procesos consolidada](Vistas4+1/XML/VistaProcesos_DiagramaActividades_P7_G4.drawio)

#### Vistas de procesos por caso de uso

##### CU-P7-01 — Consultar catálogo de eventos

![Vista de procesos CU-P7-01](Vistas4+1/VistaProcesos_DiagramaActividades_CUP7_01_P7_G4.drawio.svg)

[Fuente editable CU-P7-01](Vistas4+1/XML/VistaProcesos_DiagramaActividades_CUP7_01_P7_G4.drawio)

##### CU-P7-02 — Consultar detalle y disponibilidad

![Vista de procesos CU-P7-02](Vistas4+1/VistaProcesos_DiagramaActividades_CUP7_02_P7_G4.drawio.svg)

[Fuente editable CU-P7-02](Vistas4+1/XML/VistaProcesos_DiagramaActividades_CUP7_02_P7_G4.drawio)

##### CU-P7-03 — Solicitar reserva de cupo

![Vista de procesos CU-P7-03](Vistas4+1/VistaProcesos_DiagramaActividades_CUP7_03_P7_G4.drawio.svg)

[Fuente editable CU-P7-03](Vistas4+1/XML/VistaProcesos_DiagramaActividades_CUP7_03_P7_G4.drawio)

##### CU-P7-04 — Consultar ticket y estado de reserva

![Vista de procesos CU-P7-04](Vistas4+1/VistaProcesos_DiagramaActividades_CUP7_04_P7_G4.drawio.svg)

[Fuente editable CU-P7-04](Vistas4+1/XML/VistaProcesos_DiagramaActividades_CUP7_04_P7_G4.drawio)

##### CU-P7-05 — Verificar credencial digital

![Vista de procesos CU-P7-05](Vistas4+1/VistaProcesos_DiagramaActividades_CUP7_05_P7_G4.drawio.svg)

[Fuente editable CU-P7-05](Vistas4+1/XML/VistaProcesos_DiagramaActividades_CUP7_05_P7_G4.drawio)

### Vista de Desarrollo (Diagrama de componentes)

![Vista de desarrollo: componentes](Vistas4+1/VistaDespliegue_Practica7_G4.drawio.svg)

[Fuente editable de la vista de desarrollo](Vistas4+1/XML/VistaDespliegue_Practica7_G4.drawio.xml)

### Vista de Despliegue (Física)

![Vista de despliegue físico](Vistas4+1/VistaFisica_Practica7_G4.drawio.svg)

[Fuente editable de la vista de despliegue](Vistas4+1/XML/VistaFisica_Practica7_G4.drawio.xml)

## 17. Arquitectura SOA de Práctica 8

### 17.1 Servicios y responsabilidades

La implementación separa la consulta de talleres de la aceptación de
solicitudes y del procesamiento de reservas. La comunicación del navegador es
HTTP/HTTPS; entre servicios se usan gRPC y mensajes Protocol Buffers. No hay
una transacción SQL distribuida entre todos los servicios.

| Componente | Tecnología | Responsabilidad y dato propio |
|---|---|---|
| Frontend | Next.js/React en Vercel | Catálogo, solicitud, seguimiento y verificación pública; consume HTTP y no accede al broker ni a PostgreSQL. |
| Catálogo de Talleres | TypeScript | Lista eventos y disponibilidad; propietario de PostgreSQL Catálogo; reclama/libera cupos mediante gRPC. |
| Reservas/Ticketing | Go | Productor HTTP: valida, genera `trackingId`, publica solicitud y responde `202` tras confirmación; lee seguimiento desde Redis, sin escribir PostgreSQL. |
| RabbitMQ | Broker AMQP | Exchange y cola durable de solicitudes, mensajes persistentes, confirmación de publicación, cola de mensajes muertos y entrega con ACK manual. |
| Worker de reservas | Python | Consumidor: valida evento, reclama cupo, resuelve la reserva, persiste en PostgreSQL Reservas y actualiza seguimiento. |
| Certificados | TypeScript | Registra la credencial recibida por gRPC y ofrece consulta HTTP pública; propietario de PostgreSQL Credenciales. |
| Redis | Caché | Estado de seguimiento de reservas y caché del catálogo. |

### 17.2 Requisitos añadidos y restricciones

| ID | Requisito de Práctica 8 | Criterio comprobable |
|---|---|---|
| RF-P8-01 | Exponer catálogo, detalles, ponentes y cupos reales. | El servicio de Catálogo responde por HTTP con datos de PostgreSQL. |
| RF-P8-02 | Aceptar reservas sin esperar a la transacción final. | `POST /api/reservas` retorna `202` con `trackingId` solo después de la confirmación de RabbitMQ. |
| RF-P8-03 | Procesar en segundo plano y controlar cupos concurrentes. | El worker reclama cupo por gRPC y persiste un único resultado por `trackingId`. |
| RF-P8-04 | Emitir y verificar el pase de una reserva confirmada. | El worker registra la emisión en Certificados y la consulta pública devuelve su estado. |
| RF-P8-05 | Consultar la evolución de una solicitud. | `GET /api/reservas/{trackingId}/estado` devuelve `PENDIENTE` o el estado resuelto desde Redis. |
| RNF-P8-01 | Tolerar caída temporal del worker. | Con el worker detenido, la cola durable retiene solicitudes; al recuperarse, se procesan y reciben ACK. |
| RNF-P8-02 | Desplegar imágenes inmutables en VM. | El `docker-compose.yml` de VM usa `image`, sin directiva `build`; el pipeline ejecuta `docker compose pull` y `up -d`. |
| RNF-P8-03 | Evaluar desde Internet, no localhost. | Vercel consume las URLs HTTPS de Catálogo, Reservas y Certificados en la VM. |

RabbitMQ usa mensajes persistentes, una cola principal tipo quorum y ACK
manual. Ante una excepción transitoria del worker se emite NACK con reencolado;
mensajes inválidos o agotados por la política de entrega van a la cola de
mensajes muertos (DLQ). En esta VM de un solo nodo, la durabilidad depende del
volumen persistente; el tipo quorum **no equivale por sí solo a alta
disponibilidad multinodo**.

## 18. Flujo asíncrono y diagrama de secuencia

El diagrama siguiente actualiza la vista lógica de Práctica 7 con el flujo
real Vercel → productor Go → RabbitMQ → worker Python → servicios gRPC y BD.
Los compartimentos `ALT` son rutas mutuamente excluyentes, no pasos que
ocurren uno tras otro. `ACK` confirma a RabbitMQ que un mensaje ya se resolvió;
`NACK` solicita reencolarlo tras un fallo transitorio.

![Secuencia del flujo asíncrono de Práctica 8](Vistas4+1/VistaLogica_FlujoAsincrono_P8_G4.drawio.svg)

[Fuente editable del flujo asíncrono](Vistas4+1/XML/VistaLogica_FlujoAsincrono_P8_G4.drawio)

El `202` acredita la aceptación en la cola, no un cupo asignado. Si la
validación o la publicación fallan, no se promete seguimiento exitoso. Si el
evento no existe o no tiene cupo, el worker persiste la resolución negativa y
envía ACK; ante fallo temporal de procesamiento, reencola y conserva la
posibilidad de reintento. El estado final se obtiene consultando por
`trackingId`, sin mantener la solicitud HTTP inicial abierta.

## 19. Arquitectura física de la VM de desarrollo

El despliegue objetivo coloca Caddy y la malla de contenedores Docker Compose
en la VM de desarrollo. El navegador llega por HTTPS al proxy; los puertos de
las APIs, PostgreSQL, Redis y la consola RabbitMQ se ligan a loopback en la
configuración de VM. La red interna `academix` comunica los servicios; Caddy
usa la red del host para alcanzar los puertos publicados localmente.

![Arquitectura física de la VM de Práctica 8](Vistas4+1/VistaFisica_VMDesarrollo_P8_G4.drawio.svg)

[Fuente editable de la arquitectura física](Vistas4+1/XML/VistaFisica_VMDesarrollo_P8_G4.drawio)

Las bases `postgres-catalogo`, `postgres-reservas` y
`postgres-credenciales` tienen volúmenes propios; Redis, RabbitMQ y Caddy
también conservan datos mediante volúmenes. GitHub Actions publica cuatro
imágenes de aplicación en GHCR. En la VM, Compose solo descarga las imágenes
versionadas y recrea los servicios: está prohibido compilar allí. El detalle
operativo y las variables sin secretos se encuentran en
[DEPLOYMENT.md](../../DEPLOYMENT.md) y
[.env.vm.example](../../.env.vm.example).

## 20. Matriz SOLID: productores y consumidores

La separación no se limita a usar dos procesos: las reglas de aceptación y
las de resolución tienen dependencias distintas. La matriz muestra la
aplicación de SOLID al código y el propósito de esa decisión.

| Principio | Productor Go (`reservas-service`) | Consumidor Python (`reservation-worker`) | Para qué / evidencia en código |
|---|---|---|---|
| S — Responsabilidad única | `SolicitarReserva` valida, crea el identificador y publica; `ConsultarEstado` lee el resultado, sin transacciones de cupo. | `ProcesarSolicitud` orquesta la resolución; persistencia, mensajería y clientes gRPC viven en adaptadores distintos. | Cambiar la política de cupos o SQL no exige modificar el manejador HTTP. Véanse `internal/application/` y `services/reservation-worker/src/worker/`. |
| O — Abierto/cerrado | El caso de uso acepta un `Broker` abstracto; RabbitMQ y el broker en memoria son implementaciones. | Los puertos del worker admiten adaptadores alternos de Catálogo, Credenciales, repositorio y caché. | Sustituir infraestructura sin reescribir el flujo de negocio; `internal/application/ports/broker.go` y `worker/application/ports.py`. |
| L — Sustitución de Liskov | El broker en memoria puede reemplazar al de RabbitMQ en pruebas respetando el contrato `PublicarSolicitud`, aunque solo RabbitMQ proporciona persistencia y confirmación operativas. | Los dobles de los puertos del worker permiten ejecutar el caso de uso sin gRPC ni PostgreSQL reales, preservando los resultados esperados de las interfaces. | La sustitución se acota al contrato funcional; un doble no demuestra las garantías de infraestructura real. |
| I — Segregación de interfaces | `Broker`, `EstadoCache` y `GeneradorTracking` son contratos separados: publicar no obliga a acceder a SQL. | `CatálogoPort`, `CredencialesPort`, `ReservaRepositorio`, `SeguimientoCache` y `PublicadorResultados` separan capacidades. | Cada caso de uso depende solo de operaciones que necesita y los tests pueden inyectar dobles focalizados. |
| D — Inversión de dependencias | `SolicitarReserva` recibe `Broker` y `GeneradorTracking`; la implementación AMQP se conecta desde la capa de infraestructura. | `ProcesarSolicitud` recibe puertos y desconoce las clases concretas de gRPC, Redis y PostgreSQL. | Las reglas de negocio dependen de abstracciones, no de librerías de transporte o almacenamiento. |

La garantía de concurrencia y entrega no proviene de SOLID por sí misma:
requiere además transacciones de cupo, idempotencia por `trackingId`, cola
durable, confirmaciones del publicador y ACK/NACK del consumidor.

## 21. Pipeline, enlaces y verificación

El workflow [Práctica 8 CI/CD](../../../.github/workflows/practica8-ci-cd.yml)
ejecuta pruebas de Go, TypeScript, Python y frontend en PR hacia `develop`.
Un push a `develop` construye y publica cuatro imágenes en GHCR con un tag
`2.0.0-<SHA>`. El despliegue automático por SSH solo se ejecuta si la variable
de repositorio `VM_DEPLOY_ENABLED` es `true`; en la VM utiliza
`docker compose pull` y `docker compose up -d`. El tag Git `V2.0.0` debe
crearse y verificarse como hito de entrega; su existencia no se infiere del
workflow.

| Entregable público | Ruta o estado a comprobar |
|---|---|
| Frontend | [https://sa-practica7.vercel.app](https://sa-practica7.vercel.app). La URL existe, pero es necesario reconstruir el proyecto con las variables P8 y comprobar en el navegador que usa la VM. |
| VM - Reservas | [Salud de Reservas](https://136.119.139.125.sslip.io/reservas/api/salud). |
| VM - Catálogo | [Salud de Catálogo](https://136.119.139.125.sslip.io/catalogo/api/talleres/salud). |
| VM - Certificados | [Salud de Certificados](https://136.119.139.125.sslip.io/certificados/api/certificados/salud). |
| Container Registry | GHCR bajo `ghcr.io/thanya-gate/academix/`; adjuntar en la entrega los enlaces verificables de los cuatro paquetes/tags publicados. |

Para la comprobación final, configurar las tres variables `NEXT_PUBLIC_API_*`
de Vercel con las URLs HTTPS de la VM, crear un despliegue nuevo y confirmar
desde el navegador catálogo, reserva `202`, consulta por `trackingId` y
verificación. En la VM, detener temporalmente el worker en un entorno de
prueba, solicitar una reserva, observar que la cola retiene el mensaje y
reactivarlo para comprobar el ACK y el resultado persistido. Verificar además
los volúmenes, la ejecución del workflow y los enlaces del registry. Estas
comprobaciones requieren evidencia operativa; no se marcan como realizadas
por el solo hecho de documentar el diseño.

## 22. Conclusiones

Práctica 8 convierte el modelo de Práctica 7 en una malla SOA con aceptación
rápida de solicitudes, procesamiento asíncrono y persistencia separada. El
productor no promete cupo al responder `202`; el worker resuelve después y el
cliente consulta el resultado. Los diagramas y la matriz SOLID muestran dónde
están esos límites de responsabilidad. Para cerrar la entrega aún deben
adjuntarse las evidencias públicas de Vercel integrado, la VM, GHCR, el
pipeline y el tag de versión que correspondan al despliegue real.
