'use client'

import { useWizardStore } from '@/hooks/useWizardStore'
import { THEME_LABELS, THEME_DESCRIPTIONS } from '@/lib/types'
import type { ThemeConfig } from '@/lib/types'
import { ColorSwatchGrid } from '@/components/ui/ColorPickerField'
import { PhoneMockup } from '@/components/previews/PhoneMockup'
import { PanelMockup } from '@/components/previews/PanelMockup'

interface StepProps {
  errors: Record<string, string>
  setErrors: (errors: Record<string, string>) => void
}

const COLOR_KEYS: (keyof ThemeConfig)[] = [
  'primaryColor', 'accentColor', 'headerColor', 'backgroundColor', 'textColor', 'successColor', 'errorColor',
]

export function StepBranding({ errors: _errors, setErrors: _setErrors }: StepProps) {
  const theme = useWizardStore((s) => s.theme)
  const businessName = useWizardStore((s) => s.businessName)
  const shortName = useWizardStore((s) => s.shortName)
  const setThemeColor = useWizardStore((s) => s.setThemeColor)

  const displayName = shortName || businessName || 'Mi App'

  const colorItems = COLOR_KEYS.map((key) => ({
    key,
    label: THEME_LABELS[key],
    description: THEME_DESCRIPTIONS[key],
    value: theme[key],
  }))

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="text-4xl mb-3">🎨</div>
        <h2 className="text-xl font-semibold text-gray-200">Tu Marca</h2>
        <p className="text-sm text-gray-500 mt-1">Elegí los colores — los cambios se reflejan en tiempo real</p>
      </div>

      {/* Previews first - the hero of the step */}
      <div className="bg-surface-1 rounded-2xl border border-border p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-8 justify-center items-center">
          <PhoneMockup theme={theme} appName={displayName} />
          <PanelMockup theme={theme} appName={displayName} />
        </div>
      </div>

      {/* Color grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-400 text-center">
          Tocá un color para editarlo
        </h3>
        <ColorSwatchGrid
          colors={colorItems}
          onChange={(key, value) => setThemeColor(key as keyof ThemeConfig, value)}
        />
      </div>
    </div>
  )
}
