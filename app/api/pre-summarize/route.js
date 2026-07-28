import OpenAI from 'openai';
import { getIP, checkAndCountIP, checkBudget, recordSpend } from '../../../lib/quota';
import { costEUR } from '../../../lib/pricing';

const PROJECT = 'recruitai';
const MODEL = 'gpt-4.1-nano'; // extraer campos de una oferta: tarea simple

export async function POST(request) {
  try {
    const { jobText } = await request.json();
    if (!jobText) return Response.json({ success: false, error: 'Falta jobText.' }, { status: 400 });

    // GATE de IP: pre-summarize se llama UNA vez al arrancar cada analisis.
    // Es el punto natural para contar "un analisis" contra la cuota diaria por IP.
    const gate = await checkAndCountIP(PROJECT, getIP(request));
    if (!gate.allowed) {
      return Response.json({ success: false, error: 'limite_ip', limit: gate.limit }, { status: 429 });
    }

    // GATE de presupuesto global.
    const budget = await checkBudget();
    if (!budget.allowed) return Response.json({ success: false, error: 'demo_agotada' }, { status: 503 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: MODEL, temperature: 0,
      messages: [{ role: 'user', content: `Extrae la informacion clave de esta oferta de trabajo en texto plano estructurado. Sin JSON, sin markdown.

Formato exacto:
PUESTO: <titulo>
EMPRESA: <nombre si aparece, si no "No especificada">
REQUISITOS OBLIGATORIOS: <lista separada por comas>
REQUISITOS VALORADOS: <lista separada por comas>
EXPERIENCIA MINIMA: <descripcion>
SKILLS TECNICAS: <lista separada por comas>
RESPONSABILIDADES: <resumen en 2-3 frases>

OFERTA:
${jobText.slice(0, 4000)}` }],
    });

    await recordSpend(PROJECT, costEUR(MODEL, res.usage));

    const jobSummary = res.choices[0].message.content ?? jobText.slice(0, 800);
    return Response.json({ success: true, jobSummary });
  } catch (err) {
    console.error('pre-summarize error', err);
    return Response.json({ success: false, error: 'Error interno.' }, { status: 500 });
  }
}