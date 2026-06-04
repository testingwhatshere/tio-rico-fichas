export interface ThemeConfig {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  headerColor: string
  errorColor: string
  successColor: string
}

export const EMPTY_THEME: ThemeConfig = {
  primaryColor: '#1B5E20',
  accentColor: '#FFD700',
  backgroundColor: '#0B0F15',
  textColor: '#E0E0E0',
  headerColor: '#0D1117',
  errorColor: '#FF5252',
  successColor: '#4CAF50',
}

export const THEME_LABELS: Record<keyof ThemeConfig, string> = {
  primaryColor: 'Color principal',
  accentColor: 'Color de acento',
  backgroundColor: 'Fondo',
  textColor: 'Texto',
  headerColor: 'Barra superior',
  errorColor: 'Errores',
  successColor: 'Éxitos',
}

export const THEME_DESCRIPTIONS: Record<keyof ThemeConfig, string> = {
  primaryColor: 'Mensajes del usuario, botones principales',
  accentColor: 'Botón enviar, elementos destacados',
  backgroundColor: 'Fondo general de la app',
  textColor: 'Color del texto y mensajes del bot',
  headerColor: 'Barra de estado y encabezado',
  errorColor: 'Mensajes de error y alertas',
  successColor: 'Confirmaciones y éxitos',
}

export interface OnboardingFormData {
  // Step 1: Identity
  businessName: string
  shortName: string
  description: string
  contactName: string

  // Step 2: URLs
  gamePanelUrl: string
  adminPanelUrl: string
  landingUrl: string
  chatWebUrl: string

  // Step 3: Branding
  theme: ThemeConfig

  // Step 4: Personalization
  aiPersona: string
  prizeTransferMessage: string
  telegramPromoPrefix: string
}

export const EMPTY_FORM: OnboardingFormData = {
  businessName: '',
  shortName: '',
  description: '',
  contactName: '',
  gamePanelUrl: '',
  adminPanelUrl: '',
  landingUrl: '',
  chatWebUrl: '',
  theme: { ...EMPTY_THEME },
  aiPersona: '',
  prizeTransferMessage: '',
  telegramPromoPrefix: '',
}

export interface StepDefinition {
  id: number
  title: string
  subtitle: string
  icon: string
}

export const STEPS: StepDefinition[] = [
  { id: 0, title: 'Tu Negocio', subtitle: 'Identidad y contacto', icon: '🏢' },
  { id: 1, title: 'Tu Panel', subtitle: 'URLs y accesos', icon: '🔗' },
  { id: 2, title: 'Tu Marca', subtitle: 'Colores e imágenes', icon: '🎨' },
  { id: 3, title: 'Personalizar', subtitle: 'Bot y mensajes', icon: '⚙️' },
]
