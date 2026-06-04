export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function toShortName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0]
  if (words.every((w) => w.length <= 4)) return words.join('')
  return words.map((w) => w[0].toUpperCase()).join('')
}

export function generateDerivedFields(businessName: string) {
  if (!businessName.trim()) return {}

  const slug = toSlug(businessName)
  const lower = businessName.toLowerCase().replace(/\s+/g, '')

  return {
    id: slug,
    shortName: toShortName(businessName),
    description: `Plataforma de carga de fichas para ${businessName}`,
    chatAppPackage: `com.${slug.replace(/-/g, '')}.fichas`,
    operatorMobilePackage: `com.${slug.replace(/-/g, '')}.operator`,
    deepLinkScheme: `${lower}fichas`,
    chatAppDisplayName: `${businessName} Fichas`,
    operatorAppDisplayName: 'Panel Operador',
    vpsUser: slug.replace(/-/g, ''),
    homeDirectory: `/opt/${slug.replace(/-/g, '')}`,
    servicePrefix: slug.replace(/-/g, ''),
    dockerImagePrefix: slug,
    telegramPromoPrefix: `📢 ${businessName}`,
  }
}
