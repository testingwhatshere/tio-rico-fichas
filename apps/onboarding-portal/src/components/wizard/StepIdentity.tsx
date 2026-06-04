'use client'

import { useWizardStore } from '@/hooks/useWizardStore'
import { useAutoSuggest } from '@/hooks/useAutoSuggest'
import { FormField } from '@/components/ui/FormField'
import type { OnboardingFormData } from '@/lib/types'

interface StepProps {
  errors: Record<string, string>
  setErrors: (errors: Record<string, string>) => void
}

export function StepIdentity({ errors, setErrors }: StepProps) {
  const store = useWizardStore()
  useAutoSuggest()

  function handleChange(field: keyof OnboardingFormData, value: string) {
    store.setField(field, value as never)
    if (field !== 'businessName') {
      store.markManualEdit(field)
    }
    if (errors[field]) {
      const next = { ...errors }
      delete next[field]
      setErrors(next)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="text-4xl mb-3">🏢</div>
        <h2 className="text-xl font-semibold text-gray-200">Tu Negocio</h2>
        <p className="text-sm text-gray-500 mt-1">Contanos sobre tu casino o sala de juegos</p>
      </div>

      <FormField
        label="Nombre del negocio"
        placeholder="Ej: Casino Royal"
        value={store.businessName}
        onChange={(e) => handleChange('businessName', e.target.value)}
        error={errors.businessName}
        required
      />

      <FormField
        label="Nombre corto"
        placeholder="Ej: CR"
        value={store.shortName}
        onChange={(e) => handleChange('shortName', e.target.value)}
        autoTag={store.autoSuggestedFields.includes('shortName')}
        hint="Se usa en íconos y espacios reducidos"
      />

      <FormField
        label="Descripción"
        placeholder="Breve descripción de tu negocio"
        value={store.description}
        onChange={(e) => handleChange('description', e.target.value)}
        autoTag={store.autoSuggestedFields.includes('description')}
        multiline
      />

      <FormField
        label="Nombre de contacto"
        placeholder="Juan Pérez"
        value={store.contactName}
        onChange={(e) => handleChange('contactName', e.target.value)}
        hint="Persona responsable de la configuración"
      />
    </div>
  )
}
