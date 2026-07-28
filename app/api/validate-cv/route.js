import OpenAI from 'openai';
import { checkBudget, recordSpend } from '../../../lib/quota';
import { costEUR } from '../../../lib/pricing';

const PROJECT = 'recruitai';
const MODEL = 'gpt-4.1-nano'; // validacion simple: mas barato y mejor que 3.5

export async function POST(request) {
  try {
    const { cvText } = await request.json();
    if (!cvText || cvText.trim().length < 20) {
      return Response.json({ success: false, error: 'Texto demasiado corto.' }, { status: 400 });
    }

    const budget = await checkBudget();
    if (!budget.allowed) return Response.json({ success: false, error: 'demo_agotada' }, { status: 503 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `¿Es el siguiente texto un CV/hoja de vida? Responde SOLO con JSON válido: { "isCv": true|false, "confidence": 0-100, "reason": "razón breve" }\n\nTEXTO:\n${cvText.slice(0, 3000)}`,
      }],
    });

    await recordSpend(PROJECT, costEUR(MODEL, response.usage));

    const parsed = JSON.parse(response.choices?.[0]?.message?.content ?? '{}');
    return Response.json({ success: true, ...parsed });
  } catch (err) {
    console.error('validate-cv error', err);
    return Response.json({ success: false, error: 'Error interno.' }, { status: 500 });
  }
}