import type { OnboardingFormData } from './types'
import { generateDerivedFields } from './autofill'

export function buildOutputConfig(data: OnboardingFormData) {
  const derived = generateDerivedFields(data.businessName)

  return {
    ...derived,

    businessName: data.businessName,
    shortName: data.shortName || derived.shortName,
    description: data.description || derived.description,
    gamePanelUrl: data.gamePanelUrl,
    adminPanelUrl: data.adminPanelUrl,
    theme: { ...data.theme },
    aiPersona: data.aiPersona,
    prizeTransferMessage: data.prizeTransferMessage,
    telegramPromoPrefix: data.telegramPromoPrefix || derived.telegramPromoPrefix,

    _onboarding: {
      contactName: data.contactName,
      generatedAt: new Date().toISOString(),
      portalVersion: '1.0.0',
    },
  }
}

export function downloadJson(data: OnboardingFormData) {
  const config = buildOutputConfig(data)
  const json = JSON.stringify(config, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `config-${config.id || 'cliente'}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
