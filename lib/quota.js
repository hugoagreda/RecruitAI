// lib/quota.js
// Cap global (protege la tarjeta) + contabilidad por proyecto (mide gasto).
// Plantilla de flota: se copia tal cual a cada proyecto del portfolio.
// Lo unico que cambia por proyecto es el `project` que se le pasa a cada funcion.

import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';

// Lazy init: NO crear el cliente a nivel de modulo, o el build peta sin env vars.
let _redis = null;
function redis() {
  if (!_redis) _redis = Redis.fromEnv(); // lee UPSTASH_REDIS_REST_URL y _TOKEN
  return _redis;
}

// --- Configuracion ---
export const DAILY_BUDGET_EUR = 5;    // bote global compartido por TODO el portfolio
export const MAX_ANALYSES_PER_IP = 3; // analisis/dia por IP en ESTE proyecto

const DAY_TTL = 60 * 60 * 36; // 36h: cubre el dia y limpia las claves solo
const MICRO = 1_000_000;      // el gasto se guarda en micro-euros enteros (1 EUR = 1e6)

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Extrae la IP del request (Vercel la pone en x-forwarded-for) y la HASHEA.
// Guardamos el hash, no la IP cruda, por privacidad.
export function getIP(request) {
  const fwd = request.headers.get('x-forwarded-for');
  const raw = fwd ? fwd.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? 'unknown');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// --- 1) GATE por IP: llamar UNA vez al empezar un analisis ---
// Cuenta analisis (submits completos), no llamadas sueltas.
export async function checkAndCountIP(project, ipHash) {
  const key = `ip:${project}:${ipHash}:${today()}`;
  const used = await redis().incr(key); // atomico: suma y devuelve el nuevo total
  if (used === 1) await redis().expire(key, DAY_TTL);

  if (used > MAX_ANALYSES_PER_IP) {
    await redis().decr(key); // ya estaba en el tope: deshace este incremento
    return { allowed: false, used: MAX_ANALYSES_PER_IP, limit: MAX_ANALYSES_PER_IP };
  }
  return { allowed: true, used, limit: MAX_ANALYSES_PER_IP };
}

// --- 2) GATE de presupuesto: llamar antes de CADA llamada a OpenAI ---
// Solo lee, no reserva. Si el bote del dia ya esta lleno, corta.
export async function checkBudget() {
  const micro = Number((await redis().get(`spend:portfolio:${today()}`)) ?? 0);
  return { allowed: micro < DAILY_BUDGET_EUR * MICRO, spent: micro / MICRO, budget: DAILY_BUDGET_EUR };
}

// --- 3) REGISTRO de gasto: llamar tras CADA llamada a OpenAI ---
// Suma el coste real (en EUR) al bote global y al contador del proyecto.
export async function recordSpend(project, eur) {
  if (!eur || eur <= 0) return;
  const micro = Math.round(eur * MICRO);
  const globalKey  = `spend:portfolio:${today()}`;
  const projectKey = `spend:${project}:${today()}`;

  const g = await redis().incrby(globalKey, micro);  // atomico
  const p = await redis().incrby(projectKey, micro);
  if (g === micro) await redis().expire(globalKey, DAY_TTL);
  if (p === micro) await redis().expire(projectKey, DAY_TTL);
}

// --- Helper de lectura (para un dashboard futuro) ---
export async function getSpendEUR(scope = 'portfolio') {
  const micro = Number((await redis().get(`spend:${scope}:${today()}`)) ?? 0);
  return micro / MICRO;
}