// ─────────────────────────────────────────────────────────────────────────────
// LIMIT REACHED — CTA cuando se agota la demo (cap por IP o presupuesto global)
// ─────────────────────────────────────────────────────────────────────────────

// Contacto — mismo patron que el footer del portfolio.
// Los enlaces llevan un mensaje pre-escrito para bajar la friccion de contactar.
const WHATSAPP_NUM = '34689070010';
const EMAIL = 'hugoagreda22@gmail.com';
const CONTACT_MSG = 'Hola Hugo, vengo de la demo de RecruitAI. Me gustaría comentarte una idea.';
const EMAIL_SUBJECT = 'RecruitAI — hablemos de un proyecto';

const CONTACT = {
  whatsapp: `https://wa.me/${WHATSAPP_NUM}?text=${encodeURIComponent(CONTACT_MSG)}`,
  email: `mailto:${EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(CONTACT_MSG)}`,
};

function LimitReached({ kind, onClose }) {
  const isBudget = kind === 'budget';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl p-7 max-w-md w-full mx-4 z-10 animate-fadeUp text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <p className="font-display font-bold text-slate-900 text-xl mb-2">
          {isBudget ? 'Demo agotada por hoy' : 'Has alcanzado el límite de la demo'}
        </p>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          {isBudget
            ? 'La demo pública ha alcanzado su límite de uso diario. Vuelve mañana para seguir probándola — o si la necesitas ya, hablemos.'
            : 'Has usado las evaluaciones diarias de la demo. Si necesitas RecruitAI sin límites para tu equipo o tu proceso de selección, hablemos.'}
        </p>
        <div className="flex flex-col gap-2">
          <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer"
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-display font-bold rounded-xl transition-colors">
            ¿Lo necesitas para tu equipo? Hablemos
          </a>
          <a href={CONTACT.email}
            className="w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">
            O escríbeme por email
          </a>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 py-1 mt-1">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP