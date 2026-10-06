# Delta for results-reporting

## ADDED Requirements

### Requirement: Métricas de conversión derivadas de outcomes

`GET /api/metrics/results` MUST devolver contactados, cerrados y tasa calculados SIEMPRE a partir de `outcomes` (nunca contados a mano): `contacted`, `closed` y `rate = closed / contacted`. La ruta es CRM (`401` sin sesión).

#### Scenario: Tasa de conversión

- DADO 10 contactados y 3 cerrados
- CUANDO se llama `GET /api/metrics/results`
- ENTONCES responde `contacted=10`, `closed=3`, `rate=0.3`

#### Scenario: Sin contactados

- DADO cero filas en `outcomes`
- CUANDO se llama `GET /api/metrics/results`
- ENTONCES devuelve `contacted=0`, `closed=0` y la tasa definida como 0 (sin división por cero)

### Requirement: Desglose por source_channel

Las métricas MUST incluir un desglose `by_channel[]` con la tasa por cada canal (`referral | partner | maps-csv | inbound | ads`) más un subtotal `total`, y la tira de contador de la cola MUST mostrarlo.

#### Scenario: Cerrados repartidos por canal

- DADO cerrados repartidos por canal
- CUANDO se pide el desglose
- ENTONCES devuelve `by_channel[]` con tasa por `referral/partner/maps-csv/inbound/ads` y subtotal `total`

### Requirement: Contador visible en el demo

La vista `/demo` MUST mostrar el mismo contador (contactados · cerrados · tasa, con desglose por canal) calculado sobre datos del tenant `demo`.

#### Scenario: Visitante del demo ve el contador

- DADO el visitante del `/demo`
- CUANDO ve el contador
- ENTONCES muestra las mismas métricas calculadas sobre datos del tenant `demo`
