# Delta for outreach-outcomes

## ADDED Requirements

### Requirement: Asistencia de saludo frío (nunca automatizado)

El sistema MUST generar borradores de saludo frío vía `POST /api/outreach/:businessId/draft` sin propuesta comercial: el outreach es manual SIEMPRE (el sistema jamás envía mensajes por sí solo). Un validador MUST rechazar con `422` cualquier draft que incluya oferta.

#### Scenario: Draft sin oferta

- DADO un negocio en la cola
- CUANDO se pide un draft
- ENTONCES devuelve un saludo frío sin propuesta comercial (`200`)

#### Scenario: Draft con oferta

- DADO un draft que incluye propuesta comercial (precio, descuento, promoción)
- CUANDO se envía a validación
- ENTONCES el validador responde `422` y no se persiste

### Requirement: Registro de contacto y outcome

El sistema MUST registrar el primer contacto (`POST /api/outreach/:businessId/contacted`) y el outcome sí/no (`POST /api/outreach/:businessId/outcome`), que MUST crear la fila en `outcomes`, transicionar el negocio a `client` (o `discarded`) y alimentar el contador derivado de resultados.

#### Scenario: Outcome cliente

- DADO un negocio contactado
- CUANDO se registra outcome `client`
- ENTONCES el estado pasa a `client`, nace la fila en `outcomes` y el contador de cerrados sube 1

### Requirement: Cierre protegido contra sobreescritura

El sistema MUST rechazar con `409` cualquier intento de registrar un outcome sobre un negocio ya cerrado; un cierre nunca se pisa.

#### Scenario: Segundo outcome sobre negocio cerrado

- DADO un negocio ya cerrado
- CUANDO se intenta otro outcome
- ENTONCES responde `409` (no se pisa un cierre) y `outcomes` conserva el registro original
