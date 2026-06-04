import type { OnboardingFormData } from './types'

export interface ValidationError {
  field: string
  message: string
}

const URL_REGEX = /^https?:\/\/.+/

export function validateStep(step: number, data: OnboardingFormData): ValidationError[] {
  const errors: ValidationError[] = []

  switch (step) {
    case 0: // Identity
      if (!data.businessName.trim()) {
        errors.push({ field: 'businessName', message: 'El nombre del negocio es obligatorio' })
      } else if (data.businessName.trim().length < 2) {
        errors.push({ field: 'businessName', message: 'El nombre debe tener al menos 2 caracteres' })
      }
      break

    case 1: // URLs
      if (!data.gamePanelUrl.trim()) {
        errors.push({ field: 'gamePanelUrl', message: 'La URL del panel de juego es obligatoria' })
      } else if (!URL_REGEX.test(data.gamePanelUrl)) {
        errors.push({ field: 'gamePanelUrl', message: 'Debe ser una URL válida (https://...)' })
      }
      if (data.adminPanelUrl && !URL_REGEX.test(data.adminPanelUrl)) {
        errors.push({ field: 'adminPanelUrl', message: 'URL inválida' })
      }
      break

    case 2: // Branding - colors always valid (pre-filled), no required images
      break

    case 3: // Personalization - all optional
      break
  }

  return errors
}
