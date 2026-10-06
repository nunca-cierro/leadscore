# Delta for configurable-scoring

## ADDED Requirements

### Requirement: Evaluación rules con preset de 8 criterios

El sistema MUST evaluar un negocio con `evaluateScore()` puro sobre los `score_criteria` activos: `value = Σ weight(met)`, `max = Σ weight(enabled)`, persistiendo el resultado en `score_evaluations` con `source='rules'` y el desglose por criterio. El seed MUST instala el preset de 8 criterios (§9) con `weight=1` y `enabled=true`.

#### Scenario: Evaluación con 5 de 8 criterios cumplidos

- DADO el preset de 8 criterios
- CUANDO se evalúa un negocio con 5 criterios cumplidos
- ENTONCES devuelve `value=5`, `max=8` y el desglose por criterio

#### Scenario: Score de la cola deriva de la última evaluación rules

- DADO un negocio con varias evaluaciones históricas
- CUANDO se calcula su score en la cola
- ENTONCES se usa el último `score_evaluations.value` con `source='rules'`

### Requirement: Criterios configurables

El sistema MUST exponer CRUD de criterios (`GET/POST/PATCH /api/score/criteria`) sobre `polarity`, `weight`, `threshold`, `mode` y `enabled`. El threshold MUST compararse contra la señal cruda; `positive` suma cuando la señal cumple, `inverse` suma cuando NO se cumple (únicos inversos: `no_website`, `no_wa_reply`). Un criterio `mode=manual` sin dato MUST contar como no cumplido y quedar marcado como pendiente en el breakdown.

#### Scenario: Threshold no alcanzado y criterio deshabilitado

- DADO un criterio `rating_45` con threshold 4.5
- CUANDO la señal cruda es 4.3
- ENTONCES el criterio NO cumple y el score baja; poner `enabled=false` lo excluye del `max`

#### Scenario: Criterio manual sin dato

- DADO un criterio con `mode=manual` sin dato capturado
- CUANDO se evalúa
- ENTONCES cuenta como no cumplido y queda marcado como pendiente en el breakdown

#### Scenario: Criterio inverso

- DADO el criterio inverso `no_website`
- CUANDO el negocio SÍ tiene sitio web (la señal cruda se cumple)
- ENTONCES el criterio NO aporta punto (inverso suma solo cuando la señal no se cumple)
