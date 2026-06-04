'use client'

import { useWizardStore } from '@/hooks/useWizardStore'
import { downloadJson } from '@/lib/config-builder'
import { generatePdf } from '@/components/pdf/generatePdf'
import { THEME_LABELS } from '@/lib/types'
import type { ThemeConfig } from '@/lib/types'
import { PhoneMockup } from '@/components/previews/PhoneMockup'
import { PanelMockup } from '@/components/previews/PanelMockup'
import { Button } from '@/components/ui/Button'

interface SummaryScreenProps {
  onStartOver: () => void
}

export function SummaryScreen({ onStartOver }: SummaryScreenProps) {
  const store = useWizardStore()
  const formData = store.getFormData()
  const displayName = store.shortName || store.businessName || 'Mi App'

  const colorKeys = Object.keys(THEME_LABELS) as (keyof ThemeConfig)[]

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="text-5xl">✅</div>
        <h2 className="text-2xl font-bold text-gray-200">Tu configuración está lista</h2>
        <p className="text-sm text-gray-500">Revisá el resumen y descargá los archivos</p>
      </div>

      {/* Download buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button onClick={() => downloadJson(formData)} className="text-base px-8 py-3">
          Descargar JSON
        </Button>
        <Button onClick={() => generatePdf(formData)} variant="secondary" className="text-base px-8 py-3">
          Descargar PDF
        </Button>
      </div>

      {/* Previews */}
      <div className="bg-surface-1 rounded-2xl border border-border p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row gap-8 justify-center items-center">
          <PhoneMockup theme={store.theme} appName={displayName} />
          <PanelMockup theme={store.theme} appName={displayName} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard title="Tu Negocio" icon="🏢">
          <SummaryField label="Nombre" value={store.businessName} />
          <SummaryField label="Nombre corto" value={store.shortName} />
          <SummaryField label="Descripción" value={store.description} />
          <SummaryField label="Contacto" value={store.contactName} />
        </SummaryCard>

        <SummaryCard title="Tu Panel" icon="🔗">
          <SummaryField label="Panel de juego" value={store.gamePanelUrl} />
          <SummaryField label="Panel admin" value={store.adminPanelUrl} />
        </SummaryCard>

        <SummaryCard title="Tu Marca" icon="🎨">
          <div className="flex flex-wrap gap-2">
            {colorKeys.map((key) => (
              <div key={key} className="flex items-center gap-1.5">
                <div
                  className="w-5 h-5 rounded-md border border-white/10"
                  style={{ backgroundColor: store.theme[key] }}
                />
                <span className="text-[10px] text-gray-500">{THEME_LABELS[key]}</span>
              </div>
            ))}
          </div>
        </SummaryCard>

        <SummaryCard title="Personalizar" icon="⚙️">
          <SummaryField label="Personalidad del bot" value={store.aiPersona} />
          <SummaryField label="Mensaje de premios" value={store.prizeTransferMessage} />
          <SummaryField label="Prefijo Telegram" value={store.telegramPromoPrefix} />
        </SummaryCard>
      </div>

      {/* Start over */}
      <div className="text-center pt-4 pb-8">
        <Button variant="ghost" onClick={onStartOver} className="text-xs">
          Empezar de nuevo
        </Button>
      </div>
    </div>
  )
}

function SummaryCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function SummaryField({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className="text-xs text-gray-300 break-words">{value}</p>
    </div>
  )
}
