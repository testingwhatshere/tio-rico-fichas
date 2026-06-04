import type { ClientConfig } from './types'

/**
 * Given a business name, suggests values for other fields.
 * Only suggests for fields that are currently empty.
 */
export function generateSuggestions(
  businessName: string,
  current: ClientConfig
): Partial<ClientConfig> {
  if (!businessName.trim()) return {}

  const slug = toSlug(businessName)
  const camel = toCamelCase(businessName)
  const lower = businessName.toLowerCase().replace(/\s+/g, '')

  const suggestions: Partial<ClientConfig> = {}

  if (!current.id) suggestions.id = slug
  if (!current.shortName) suggestions.shortName = toShortName(businessName)
  if (!current.chatAppPackage) suggestions.chatAppPackage = `com.${slug.replace(/-/g, '')}.fichas`
  if (!current.operatorMobilePackage) suggestions.operatorMobilePackage = `com.${slug.replace(/-/g, '')}.operator`
  if (!current.deepLinkScheme) suggestions.deepLinkScheme = `${lower}fichas`
  if (!current.chatAppDisplayName) suggestions.chatAppDisplayName = `${businessName} Fichas`
  if (!current.operatorAppDisplayName) suggestions.operatorAppDisplayName = 'Panel Operador'
  if (!current.vpsUser) suggestions.vpsUser = slug.replace(/-/g, '')
  if (!current.homeDirectory) suggestions.homeDirectory = `/opt/${slug.replace(/-/g, '')}`
  if (!current.servicePrefix) suggestions.servicePrefix = slug.replace(/-/g, '')
  if (!current.dockerImagePrefix) suggestions.dockerImagePrefix = slug
  if (!current.telegramPromoPrefix) suggestions.telegramPromoPrefix = `📢 ${businessName}`
  if (!current.description) suggestions.description = `Plataforma de carga de fichas para ${businessName}`

  return suggestions
}

/**
 * Generates a cryptographically-looking random string for secrets.
 */
export function generateSecret(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length]
  }
  return result
}

/**
 * Generates a simple memorable API key.
 */
export function generateApiKey(): string {
  const adjectives = ['Rojo', 'Azul', 'Verde', 'Dorado', 'Negro', 'Blanco', 'Rapido', 'Fuerte', 'Noble', 'Bravo']
  const nouns = ['Leon', 'Aguila', 'Tigre', 'Halcon', 'Dragon', 'Lobo', 'Fenix', 'Titan', 'Atlas', 'Zeus']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 900) + 100
  return `${adj}${noun}${num}`
}

// --- Helpers ---

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function toCamelCase(name: string): string {
  return name
    .split(/\s+/)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

function toShortName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0]
  // If 2+ words, take first letters capitalized
  if (words.every(w => w.length <= 4)) return words.join('')
  return words.map(w => w[0].toUpperCase()).join('') // Acronym
}
