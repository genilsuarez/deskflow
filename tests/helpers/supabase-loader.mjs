// Loader ESM que redirige './lp-supabase.js' al stub de pruebas.
//
// lp-supabase.js importa el SDK desde https://esm.sh/@supabase/supabase-js@2 y
// el loader por defecto de Node solo resuelve file:, data: y node:. Sin este
// redirect, sync-engine.js —790 líneas con el merge de la nube y la poda del
// ledger— no se puede importar en una prueba.

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('lp-supabase.js')) {
    return {
      url: new URL('./supabase-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
