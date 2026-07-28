// lib/pricing.js
// Precio por millón de tokens (input / output) en USD, y conversión a EUR.
// Fuente: pricing OpenAI. Revisa estos números si OpenAI cambia tarifas.
//
// Solo se usan para CONTABILIDAD (estimar el coste real de cada llamada y
// sumarlo al bote). No afectan al comportamiento del modelo.

const USD_PER_MTOK = {
  'gpt-4o-mini':   { input: 0.15, output: 0.60 },
  'gpt-4.1-mini':  { input: 0.40, output: 1.60 },
  'gpt-4.1-nano':  { input: 0.10, output: 0.40 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 }, // legacy, por si queda alguna llamada
};

// Tipo de cambio aproximado USD->EUR. Ajusta si quieres precisión;
// para un cap de seguridad, un valor fijo sobra.
const USD_TO_EUR = 0.92;

/**
 * Coste en EUR de una llamada, a partir del `usage` que devuelve OpenAI.
 * @param {string} model
 * @param {{prompt_tokens?: number, completion_tokens?: number}} usage
 * @returns {number} coste en euros (0 si no hay datos)
 */
export function costEUR(model, usage) {
  const price = USD_PER_MTOK[model];
  if (!price || !usage) return 0;

  const inTok  = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;

  const usd = (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
  return usd * USD_TO_EUR;
}