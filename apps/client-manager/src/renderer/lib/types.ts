export interface ClientConfig {
  id: string
  businessName: string
  shortName: string
  description: string

  // Android / App
  chatAppPackage: string
  operatorMobilePackage: string
  deepLinkScheme: string
  chatAppDisplayName: string
  operatorAppDisplayName: string

  // URLs
  apiUrl: string
  landingUrl: string
  chatWebUrl: string
  gamePanelUrl: string
  adminPanelUrl: string

  // Credentials
  defaultPanelPassword: string
  botApiKey: string
  operatorApiKey: string
  validatorApiKey: string
  jwtSecret: string

  // Theme
  theme: ThemeConfig

  // Bot / Messages
  aiPersona: string
  prizeTransferMessage: string
  telegramPromoPrefix: string

  // Server / Deploy
  vpsUser: string
  homeDirectory: string
  servicePrefix: string
  dockerRegistry: string
  dockerImagePrefix: string

  // Monitoring
  monitoringApiKey: string

  // Deployment
  deployment: DeploymentConfig
}

export interface DeploymentConfig {
  databaseUrl: string
  cloudinaryUrl: string
  telegramBotToken: string
  telegramChatId: string
  renderServiceIds: {
    api: string
    chatWeb: string
    landing: string
  }
}

export interface ThemeConfig {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  headerColor: string
  errorColor: string
  successColor: string
}

export interface PanelProfile {
  _name: string
  _description: string
  [selectorKey: string]: string
}

// --- Monitoring ---

export interface MonitoringData {
  revenue: { today: number; week: number; month: number; total: number; currency: string }
  volume: { todayCount: number; weekCount: number; monthCount: number; totalCount: number }
  system: {
    botStatus: 'online' | 'offline' | 'busy'
    killSwitch: boolean
    uptime: number
    dbLatency: number
    queueLength: number
    activeJobs: number
  }
  failures: { pendingCount: number; todayCount: number }
  operators: { total: number; online: number }
  panelBalance: { amount: number; panelName: string }[]
  recentRequests: { completed: number; failed: number; pending: number }
}

export interface ClientMonitoringState {
  data: MonitoringData | null
  loading: boolean
  error: string | null
  lastUpdated: number | null // timestamp
}

// --- Commissions ---

export type FeeType = 'fixed' | 'percentage' | 'both'

export interface CommissionConfig {
  feeType: FeeType
  fixedMonthlyFee: number
  percentageRate: number
  currency: string
}

export interface CommissionPeriod {
  period: string // "2026-04"
  volumeLoaded: number
  requestCount: number
  commissionFromVolume: number
  fixedFee: number
  totalCommission: number
  paid: boolean
  paidAt: string | null
  notes: string
}

export interface CommissionData {
  config: CommissionConfig
  history: CommissionPeriod[]
}

export const EMPTY_COMMISSION_DATA: CommissionData = {
  config: { feeType: 'both', fixedMonthlyFee: 0, percentageRate: 0.05, currency: 'ARS' },
  history: [],
}

export const EMPTY_DEPLOYMENT: DeploymentConfig = {
  databaseUrl: '',
  cloudinaryUrl: '',
  telegramBotToken: '',
  telegramChatId: '',
  renderServiceIds: { api: '', chatWeb: '', landing: '' },
}

// --- Existing ---

export interface ClientSummary {
  id: string
  businessName: string
  status: 'complete' | 'incomplete'
  hasProfile: boolean
  assetCount: number
}

export interface ClientData {
  config: ClientConfig
  profile: PanelProfile | null
  assets: string[]
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

export const EMPTY_CONFIG: ClientConfig = {
  id: '',
  businessName: '',
  shortName: '',
  description: '',
  chatAppPackage: '',
  operatorMobilePackage: '',
  deepLinkScheme: '',
  chatAppDisplayName: '',
  operatorAppDisplayName: '',
  apiUrl: '',
  landingUrl: '',
  chatWebUrl: '',
  gamePanelUrl: '',
  adminPanelUrl: '',
  defaultPanelPassword: '',
  botApiKey: '',
  operatorApiKey: '',
  validatorApiKey: '',
  jwtSecret: '',
  theme: { ...EMPTY_THEME },
  aiPersona: '',
  prizeTransferMessage: '',
  telegramPromoPrefix: '',
  vpsUser: '',
  homeDirectory: '',
  servicePrefix: '',
  dockerRegistry: '',
  dockerImagePrefix: '',
  monitoringApiKey: '',
  deployment: { ...EMPTY_DEPLOYMENT },
}
