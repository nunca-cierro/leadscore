import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase server-side (anon key).
 *
 * Usa SIEMPRE la anon key para que RLS se aplique (SPEC.md §3: "dejar
 * RLS bien hecho desde el día uno"). La service-role key salta RLS
 * completa y no debe usarse aquí; si alguna operación privilegiada la
 * necesita, deberá crear un cliente explícito y acotado.
 *
 * Fase 1: pasar el JWT del usuario de la petición entrante vía
 * `global.headers.Authorization` cuando exista el middleware de auth.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
