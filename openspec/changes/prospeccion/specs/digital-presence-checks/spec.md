# Delta for digital-presence-checks

## ADDED Requirements

### Requirement: Checks automáticos de presencia digital

El sistema MUST ejecutar los checks automáticos de un negocio vía `POST /api/checks/run/:businessId` (HTTP de sitio, detección `wa.me`, Facebook) y persistir cada resultado en `analysis_checks` con `check_type`, payload `result` (jsonb) y `checked_at`. Los criterios con `mode=auto` (p. ej. `no_website`) MUST consumir estos checks como señal cruda.

#### Scenario: Check de sitio web fallido

- DADO un negocio sin sitio web
- CUANDO corre `POST /api/checks/run/:id`
- ENTONCES se registra `check_type=http_site` fallido con timestamp en `analysis_checks`

#### Scenario: Negocio inexistente

- DADO un `businessId` que no existe en el tenant actual
- CUANDO se llama `POST /api/checks/run/:id` con sesión válida
- ENTONCES la respuesta es `404` y no se escribe ningún registro

### Requirement: Historial de checks (append, no sobrescritura)

El sistema MUST tratar `analysis_checks` como historial: cada ejecución añade registros NUEVOS con `checked_at` actualizado sin borrar ni sobrescribir los anteriores. `GET /api/checks/:businessId` MUST devolver el historial completo del negocio.

#### Scenario: Re-ejecución del runner

- DADO un negocio con checks ya registrados
- CUANDO se repite el run
- ENTONCES se añaden registros nuevos con `checked_at` actualizado (historial, no sobrescritura)
