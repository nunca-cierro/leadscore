# Delta for prioritized-queue

## ADDED Requirements

### Requirement: Cola priorizada por score

La UI MUST mostrar una tabla única ordenada por score descendente (sin Kanban, sin drag & drop, sin `@dnd-kit`), con filtros por vertical, ciudad y estado. `GET /api/businesses` MUST soportar los parámetros de orden/filtro y devolver `401` sin sesión.

#### Scenario: Orden por score descendente

- DADO varios negocios con scores 7, 4 y 6
- CUANDO se abre la cola
- ENTONCES se listan 7, 6, 4 (score desc) sin drag & drop

#### Scenario: Filtros combinados

- DADO negocios de distintas verticales, ciudades y estados
- CUANDO se filtra por vertical, ciudad y estado a la vez
- ENTONCES solo se devuelven los negocios que cumplen los tres filtros

### Requirement: Cambio de estado por dropdown

La UI MUST permitir cambiar el estado de una fila vía dropdown (`new → contacted → client / discarded`) persistiendo con `PATCH /api/businesses/:id`. El servidor MUST validar el payload con zod (`400` inválido, `404` inexistente, `401` sin sesión).

#### Scenario: Contactar un negocio nuevo

- DADO un negocio `new`
- CUANDO se cambia a `contacted` por dropdown
- ENTONCES persiste vía PATCH, devuelve `200` y la fila refleja el nuevo estado

#### Scenario: Estado fuera del enum

- DADO un payload con un estado inexistente en el enum
- CUANDO se envía el PATCH
- ENTONCES la respuesta es `400` y el negocio conserva su estado anterior
