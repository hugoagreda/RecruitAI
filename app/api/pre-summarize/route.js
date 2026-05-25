import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const { jobText } = await request.json();
    if (!jobText) return Response.json({ success: false, error: 'Falta jobText.' }, { status: 400 });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0,
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

    const jobSummary = res.choices[0].message.content ?? jobText.slice(0, 800);
    return Response.json({ success: true, jobSummary });
  } catch (err) {
    console.error('pre-summarize error', err);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}