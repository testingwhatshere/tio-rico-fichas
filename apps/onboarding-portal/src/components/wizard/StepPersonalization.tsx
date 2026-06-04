'use client'

import { useWizardStore } from '@/hooks/useWizardStore'
import { FormField } from '@/components/ui/FormField'

interface StepProps {
  errors: Record<string, string>
  setErrors: (errors: Record<string, string>) => void
}

export function StepPersonalization({ errors: _errors, setErrors: _setErrors }: StepProps) {
  const store = useWizardStore()

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="text-4xl mb-3">⚙️</div>
        <h2 className="text-xl font-semibold text-gray-200">Personalizar</h2>
        <p className="text-sm text-gray-500 mt-1">Configurá el tono del bot y los mensajes automáticos</p>
      </div>

      <FormField
        label="Personalidad del bot"
        multiline
        placeholder={'Ej: Amigable, informal, usa "vos" en vez de "tú". Responde de forma concisa y directa.'}
        value={store.aiPersona}
        onChange={(e) => store.setField('aiPersona', e.target.value)}
        hint="Define cómo habla el bot con tus usuarios. Si lo dejás vacío, usamos un tono amigable por defecto."
      />

      <FormField
        label="Mensaje de transferencia de premios"
        multiline
        placeholder="Ej: Tu premio de {amount} fue transferido a tu cuenta. Gracias por jugar!"
        value={store.prizeTransferMessage}
        onChange={(e) => store.setField('prizeTransferMessage', e.target.value)}
        hint="Mensaje que recibe el usuario cuando se le transfiere un premio. Usá {amount} para el monto."
      />

      <FormField
        label="Prefijo de promo en Telegram"
        placeholder="Ej: 📢 Casino Royal"
        value={store.telegramPromoPrefix}
        onChange={(e) => store.setField('telegramPromoPrefix', e.target.value)}
        autoTag={store.autoSuggestedFields.includes('telegramPromoPrefix')}
        hint="Se agrega al inicio de cada mensaje promocional en Telegram"
      />
    </div>
  )
}
