import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const { candidateName, resumen, skills_gap, categorias, jobSummary } = await request.json();

    if (!jobSummary && !skills_gap?.length) {
      return Response.json({ success: false, error: 'Faltan datos del candidato.' }, { status: 400 });
    }

    const weakCats = Object.entries(categorias ?? {})
      .filter(([, v]) => (v?.score ?? 100) < 65)
      .map(([k, v]) => {
        const labels = { formacion: 'Formación', experiencia: 'Experiencia', conocimientos_tecnicos: 'Conocimientos técnicos', soft_skills: 'Soft skills' };
        return `${labels[k] ?? k} (${v.score}/100): ${v.comentario ?? ''}`;
      });

    const prompt = `Eres un experto en selección de personal. Genera preguntas de entrevista para verificar si el candidato realmente tiene las habilidades que no quedan claras en su CV.

PUESTO:
${jobSummary ?? 'No especificado'}

CANDIDATO: ${candidateName ?? 'Candidato'}
Resumen: ${resumen ?? ''}
Habilidades no detectadas en el CV: ${(skills_gap ?? []).join(', ') || 'Ninguna'}
Áreas con puntuación baja: ${weakCats.join(' | ') || 'Ninguna'}

Genera preguntas de entrevista agrupadas en estas categorías (solo incluye una categoría si tienes preguntas relevantes para ella):
- "habilidades": preguntas para verificar skills_gap y conocimientos técnicos no demostrados
- "experiencia": preguntas para profundizar en la trayectoria y verificar años/relevancia
- "soft_skills": preguntas situacionales para evaluar habilidades blandas

Devuelve SOLO JSON válido:
{
  "preguntas": {
    "habilidades": [<2-3 preguntas concretas y directas>],
    "experiencia": [<2-3 preguntas sobre su trayectoria>],
    "soft_skills": [<2 preguntas situacionales tipo "cuéntame una vez que...">]
  }
}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = JSON.parse(response.choices?.[0]?.message?.content ?? '{}');
    return Response.json({ success: true, preguntas: parsed.preguntas ?? {} });
  } catch (err) {
    console.error('interview-questions error', err);
    return Response.json({ success: false, error: err.message ?? 'Error interno.' }, { status: 500 });
  }
}
