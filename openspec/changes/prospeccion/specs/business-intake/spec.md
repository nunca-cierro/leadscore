# Delta for business-intake

## ADDED Requirements

### Requirement: Alta manual de negocios

El sistema MUST crear negocios vía `POST /api/businesses` validando cada frontera con zod (`packages/shared`), con `source_channel` obligatorio (D14) y `status='new'` inicial; el negocio resultante MUST aparecer en la cola priorizada. Sin sesión válida la ruta MUST responder 401.

#### Scenario: Alta vía formulario con canal de origen

- DADO un negocio encontrado en Maps
- CUANDO se da de alta vía formulario con canal `referral`
- ENTONCES nace con `status='new'`, aparece en la cola y la respuesta es `201`

#### Scenario: source_channel ausente o inválido

- DADO el formulario de alta sin `source_channel` (o con un valor fuera de `referral | partner | maps-csv | inbound | ads`)
- CUANDO se envía
- ENTONCES la validación zod rechaza con `400` y no se crea ningún negocio

### Requirement: Import de CSV tolerante

El sistema MUST importar el CSV real de 24 columnas con parser tolerante: filas multilínea con celdas entre comillas, doc-columns 22–24 descartadas sin error y errores reportados por fila SIN abortar el lote. La columna `Score` del CSV MUST NO importarse: el score se recalcula con el preset → `score_evaluations`.

#### Scenario: Import del CSV real

- DADO el CSV real de 24 columnas con filas multilínea
- CUANDO se importa vía `POST /api/businesses/import`
- ENTONCES se crean los ~12 negocios, las doc-columns (22–24) se ignoran sin error y el detalle de filas malformadas se reporta sin abortar el lote

#### Scenario: Columnas doc ignoradas y Score no importado

- DADO un CSV con las columnas 22–24 (`Campo`, `Propósito y Formato`, `Comportamiento`) y un valor `Score` por fila
- CUANDO se importa
- ENTONCES las doc-columns se descartan sin error, el `Score` del CSV no se persiste y el score resultante proviene del preset evaluado
