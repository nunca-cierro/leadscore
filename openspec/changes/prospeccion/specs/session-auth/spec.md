# Delta for session-auth

## ADDED Requirements

### Requirement: Login con cookie httpOnly y argon2id

El sistema MUST autenticar vía `POST /api/auth/login` comparando `argon2id` contra `users`, y en éxito MUST setear la cookie `__Host-ls_session` (`HttpOnly`, `SameSite=Lax`, `Secure`, `Path=/`, sin `Domain` — el prefijo `__Host-` hace que el navegador **rechace** la cookie si falta cualquiera de esos atributos) junto a una fila en `sessions` con `tenant_id`, `user_id` y `expires_at`. Credenciales inválidas MUST responder `401`; payload inválido, `400`.

#### Scenario: Login correcto

- DADO credenciales válidas
- CUANDO se hace login
- ENTONCES se setea cookie `HttpOnly` y `/api/auth/me` responde `200` con el `tenant_id` de la sesión

#### Scenario: Credenciales incorrectas

- DADO un password incorrecto
- CUANDO se envía el login
- ENTONCES responde `401` y no se crea sesión ni cookie

### Requirement: Guard 401 en rutas CRM

Un guard en `apps/api` MUST exigir sesión válida en toda ruta CRM: sin ella, `401` sin body de datos. La allowlist pública MUST ser `/api/classify`, `/api/demo/*` y `/health`.

#### Scenario: Cookie ausente o expirada

- DADO una cookie ausente o expirada
- CUANDO se llama cualquier ruta CRM
- ENTONCES responde `401` (sin body de datos)

#### Scenario: Allowlist pública responde sin sesión

- DADO un cliente sin cookie
- CUANDO llama `/api/classify` o `/health`
- ENTONCES la ruta responde según su contrato (no `401` por auth)

### Requirement: Aislamiento por tenant vía RLS FORCE

Todo acceso a datos MUST pasar por `withTenant()` (transacción + `SET LOCAL app.current_tenant`) y por políticas RLS `FORCE` default-deny: sin tenant o con tenant ajeno, el resultado MUST ser 0 filas, incluso con la conexión como dueño de las tablas (FORCE) o como rol de aplicación no-superuser (un superuser bypasea RLS en PostgreSQL). Una sola cuenta activa en el MVP.

#### Scenario: Query sin tenant seteado

- DADO una query ejecutada sin `SET LOCAL app.current_tenant`
- CUANDO pasa por RLS `FORCE`
- ENTONCES devuelve 0 filas incluso con la conexión como dueño de las tablas o rol de aplicación no-superuser (un superuser bypasea RLS)

#### Scenario: Tenant ajeno

- DADO datos pertenecientes a otro tenant
- CUANDO se consulta desde la sesión de un tenant distinto
- ENTONCES el resultado contiene 0 filas ajenas
