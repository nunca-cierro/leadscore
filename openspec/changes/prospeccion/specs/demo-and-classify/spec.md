# Delta for demo-and-classify

## ADDED Requirements

### Requirement: Vistas públicas sobre el tenant demo

La landing de venta (root) y `/demo` MUST ser accesibles sin autenticación y MUST leer EXCLUSIVAMENTE datos del tenant `demo` reservado (cola, criterios activables, contador) — nunca datos reales de otros tenants (D16).

#### Scenario: Visitante sin sesión en /demo

- DADO un visitante sin sesión en `leadscore.nuncacierro.com`
- CUANDO abre `/demo`
- ENTONCES ve cola, criterios activables y contador con datos del tenant `demo` (nunca datos reales)

### Requirement: /api/classify público con rate limit por IP

`POST /api/classify` MUST estar en la allowlist pública (sin sesión) y aplicar un rate limit de ventana fija por IP en memoria (`CLASSIFY_RATE_LIMIT` / `CLASSIFY_RATE_WINDOW`): al exceder el límite MUST responder `429`.

#### Scenario: Límite de peticiones por IP

- DADO un cliente HTTP en una ventana de rate limit con límite 10
- CUANDO llama `POST /api/classify` 11 veces en esa ventana
- ENTONCES las 10 primeras responden `200` y la 11ª responde `429` (fixed window por IP, en memoria)

### Requirement: Aislamiento default-deny en rutas públicas

Toda query sobre rutas públicas sin `SET LOCAL app.current_tenant` MUST atravesar RLS `FORCE ROW LEVEL SECURITY` con política default-deny: si el tenant es `NULL`, el resultado MUST ser 0 filas (incluso con la conexión como dueño de las tablas o rol de aplicación no-superuser).

#### Scenario: Bug hipotético en ruta pública

- DADO un bug hipotético en ruta pública
- CUANDO consulta con tenant NULL
- ENTONCES RLS devuelve `0` filas (default-deny)

#### Scenario: Ruta pública no filtra datos reales

- DADO datos reales en el tenant `nuncacierro` y datos sintéticos en el tenant `demo`
- CUANDO un visitante sin sesión llama a `/api/demo/queue`
- ENTONCES solo recibe filas del tenant `demo`
