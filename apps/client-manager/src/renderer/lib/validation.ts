import type { ClientConfig } from './types'

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

const URL_REGEX = /^https?:\/\/.+/
const PACKAGE_REGEX = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

export function validateClientConfig(config: ClientConfig): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  // Required fields
  if (!config.id) {
    errors.push({ field: 'id', message: 'El ID del cliente es obligatorio' })
  } else if (!SLUG_REGEX.test(config.id)) {
    errors.push({ field: 'id', message: 'ID debe ser alfanumérico con guiones (ej: "mi-cliente")' })
  }

  if (!config.businessName) {
    errors.push({ field: 'businessName', message: 'El nombre del negocio es obligatorio' })
  }

  if (!config.gamePanelUrl) {
    errors.push({ field: 'gamePanelUrl', message: 'La URL del panel de juego es obligatoria' })
  } else if (!URL_REGEX.test(config.gamePanelUrl)) {
    errors.push({ field: 'gamePanelUrl', message: 'URL del panel inválida' })
  }

  if (!config.apiUrl) {
    errors.push({ field: 'apiUrl', message: 'La URL del API es obligatoria' })
  } else if (!URL_REGEX.test(config.apiUrl)) {
    errors.push({ field: 'apiUrl', message: 'URL del API inválida' })
  }

  if (!config.botApiKey) {
    errors.push({ field: 'botApiKey', message: 'El Bot API Key es obligatorio' })
  }

  if (!config.jwtSecret) {
    errors.push({ field: 'jwtSecret', message: 'El JWT Secret es obligatorio' })
  }

  // Format validations (warnings if present but malformed)
  if (config.chatAppPackage && !PACKAGE_REGEX.test(config.chatAppPackage)) {
    warnings.push({ field: 'chatAppPackage', message: 'Package name debería tener formato com.x.y' })
  }
  if (config.operatorMobilePackage && !PACKAGE_REGEX.test(config.operatorMobilePackage)) {
    warnings.push({ field: 'operatorMobilePackage', message: 'Package name debería tener formato com.x.y' })
  }

  // URL format warnings
  for (const [field, label] of [
    ['landingUrl', 'Landing URL'],
    ['chatWebUrl', 'Chat Web URL'],
    ['adminPanelUrl', 'Admin Panel URL'],
  ] as const) {
    const val = config[field]
    if (val && !URL_REGEX.test(val)) {
      warnings.push({ field, message: `${label} no parece una URL válida` })
    }
  }

  // Optional but recommended
  if (!config.shortName) {
    warnings.push({ field: 'shortName', message: 'Nombre corto recomendado para UI' })
  }
  if (!config.defaultPanelPassword) {
    warnings.push({ field: 'defaultPanelPassword', message: 'Sin contraseña default para el panel' })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
