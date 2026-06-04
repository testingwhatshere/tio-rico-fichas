'use client'

import { useWizardStore } from '@/hooks/useWizardStore'
import { FormField } from '@/components/ui/FormField'
import type { OnboardingFormData } from '@/lib/types'

interface StepProps {
  errors: Record<string, string>
  setErrors: (errors: Record<string, string>) => void
}

export function StepUrls({ errors, setErrors }: StepProps) {
  const store = useWizardStore()

  function handleChange(field: keyof OnboardingFormData, value: string) {
    store.setField(field, value as never)
    if (errors[field]) {
      const next = { ...errors }
      delete next[field]
      setErrors(next)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="text-4xl mb-3">🔗</div>
        <h2 className="text-xl font-semibold text-gray-200">Tu Panel</h2>
        <p className="text-sm text-gray-500 mt-1">La URL del panel de juego donde se cargan las fichas</p>
      </div>

      <FormField
        label="URL del panel de juego"
        type="url"
        placeholder="https://mi-panel.com"
        value={store.gamePanelUrl}
        onChange={(e) => handleChange('gamePanelUrl', e.target.value)}
        error={errors.gamePanelUrl}
        hint="La URL principal del casino donde operan tus usuarios"
        required
      />

      <FormField
        label="URL del panel de administración"
        type="url"
        placeholder="https://admin.mi-panel.com"
        value={store.adminPanelUrl}
        onChange={(e) => handleChange('adminPanelUrl', e.target.value)}
        error={errors.adminPanelUrl}
        hint="Solo si es diferente a la URL principal — donde se gestionan usuarios y fichas"
      />

      <div className="mt-8 p-4 rounded-lg bg-surface-2 border border-border">
        <p className="text-xs text-gray-400">
          Las URLs de la landing page, chat web y API se generan durante el proceso de deploy. No necesitás completarlas ahora.
        </p>
      </div>
    </div>
  )
}
