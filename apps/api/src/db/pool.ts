import pg from "pg";

// Pool único de la app — design §1.4: conTenant y todo acceso a datos salen de aquí.
// Ojo (dev local): DATABASE_URL apunta a un superuser, que SIEMPRE bypasea RLS;
// el rol real de la app (dueño NO superuser, sujeto vía FORCE) llega en U2b (design §5).
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
