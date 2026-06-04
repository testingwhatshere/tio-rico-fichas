import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useClientStore } from '../store/client-store'
import { FormField } from '../components/FormField'
import { AssetManager } from '../components/AssetManager'
import { ThemePreview } from '../components/ThemePreview'
import { SaveSummary } from '../components/SaveSummary'
import { toast } from '../components/Toast'
import { validateClientConfig } from '../lib/validation'
import { generateSuggestions, generateSecret, generateApiKey } from '../lib/autofill'
import { DeployTools } from '../components/DeployTools'
import { CommissionEditor } from '../components/CommissionEditor'
import type { ClientConfig, ThemeConfig, DeploymentConfig } from '../lib/types'
import { EMPTY_DEPLOYMENT } from '../lib/types'
import { HexColorPicker } from 'react-colorful'

const TABS = [
  { id: 'identity', label: 'Identidad' },
  { id: 'android', label: 'Android / App' },
  { id: 'urls', label: 'URLs' },
  { id: 'credentials', label: 'Credenciales' },
  { id: 'theme', label: 'Tema' },
  { id: 'bot', label: 'Bot / Mensajes' },
  { id: 'server', label: 'Server / Deploy' },
  { id: 'assets', label: 'Assets' },
  { id: 'commissions', label: 'Comisiones' },
  { id: 'deploy', label: 'Deploy' },
] as const

type TabId = (typeof TABS)[number]['id']

export function ClientEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    editorConfig: config,
    editorAssets,
    loading,
    saving,
    isDirty,
    loadClientForEditing,
    updateConfig,
    saveCurrentClient,
    resetEditor,
  } = useClientStore()

  const [activeTab, setActiveTab] = useState<TabId>('identity')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showSaveSummary, setShowSaveSummary] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const editorProfile = useClientStore(s => s.editorProfile)
  const isNew = !id || config.id !== id

  useEffect(() => {
    if (id) {
      loadClientForEditing(id)
    }
    return () => resetEditor()
  }, [id])

  const handleSaveClick = () => {
    setShowSaveSummary(true)
  }

  const handleSaveConfirm = async () => {
    const validation = validateClientConfig(config)
    if (!validation.valid) {
      const errMap: Record<string, string> = {}
      validation.errors.forEach((e) => (errMap[e.field] = e.message))
      setErrors(errMap)
      const firstErrorField = validation.errors[0]?.field
      if (firstErrorField) {
        const tabForField = getTabForField(firstErrorField)
        if (tabForField) setActiveTab(tabForField)
      }
      setShowSaveSummary(false)
      toast(`${validation.errors.length} error(es) de validación`, 'error')
      return
    }
    setErrors({})

    const result = await saveCurrentClient()
    setShowSaveSummary(false)
    if (result.success) {
      toast('Cliente guardado', 'success')
    } else {
      toast(result.error || 'Error al guardar', 'error')
    }
  }

  const handleApplySuggestions = () => {
    const suggestions = generateSuggestions(config.businessName, config)
    if (Object.keys(suggestions).length > 0) {
      updateConfig(suggestions)
      toast(`${Object.keys(suggestions).length} campos auto-completados`, 'info')
      setShowSuggestions(false)
    }
  }

  const handleGenerateCredentials = () => {
    const updates: Partial<ClientConfig> = {}
    if (!config.jwtSecret) updates.jwtSecret = generateSecret(32)
    if (!config.botApiKey) updates.botApiKey = generateApiKey()
    if (!config.operatorApiKey) updates.operatorApiKey = generateApiKey()
    if (!config.validatorApiKey) updates.validatorApiKey = generateApiKey()
    if (Object.keys(updates).length > 0) {
      updateConfig(updates)
      toast(`${Object.keys(updates).length} credenciales generadas`, 'success')
    } else {
      toast('Todas las credenciales ya están definidas', 'info')
    }
  }

  const update = (field: keyof ClientConfig, value: string) => {
    updateConfig({ [field]: value })
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const updateTheme = (field: keyof ThemeConfig, value: string) => {
    updateConfig({ theme: { ...config.theme, [field]: value } })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-gray-500">Cargando...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (isDirty && !confirm('Tenés cambios sin guardar. ¿Salir igual?')) return
              navigate('/')
            }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            &larr; Volver
          </button>
          <h2 className="text-sm font-semibold text-gray-200">
            {config.businessName || config.id || 'Nuevo Cliente'}
          </h2>
          {isDirty && (
            <span className="text-[10px] bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded">
              Sin guardar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/client/${id}/selectors`)}
            className="px-3 py-1.5 text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-700/40 rounded transition-colors"
          >
            Selectores CSS
          </button>
          <button
            onClick={handleSaveClick}
            disabled={saving}
            className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Tabs with completion dots */}
      <div className="px-6 border-b border-border flex gap-0 shrink-0 overflow-x-auto">
        {TABS.map((tab) => {
          const fill = getTabFillLevel(tab.id, config, editorAssets)
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-accent text-gray-200'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
              <div className={`w-1.5 h-1.5 rounded-full ${
                fill === 'full' ? 'bg-green-500'
                  : fill === 'partial' ? 'bg-yellow-500'
                  : 'bg-gray-700'
              }`} />
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          {activeTab === 'identity' && (
            <>
              <FormField
                label="ID del cliente"
                value={config.id}
                onChange={(v) => update('id', v)}
                placeholder="mi-casino"
                error={errors.id}
                required
              />
              <FormField
                label="Nombre del negocio"
                value={config.businessName}
                onChange={(v) => update('businessName', v)}
                placeholder="Casino Las Vegas"
                error={errors.businessName}
                required
              />
              <FormField
                label="Nombre corto"
                value={config.shortName}
                onChange={(v) => update('shortName', v)}
                placeholder="LasVegas"
              />
              <FormField
                label="Descripción"
                value={config.description}
                onChange={(v) => update('description', v)}
                type="textarea"
                placeholder="Plataforma de carga de fichas para..."
                rows={3}
              />

              {/* Auto-fill suggestion */}
              {config.businessName && (
                <div className="mt-2 p-3 bg-accent/5 border border-accent/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-accent">Auto-completar campos</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Rellena ID, packages, prefijos y mas a partir del nombre
                      </p>
                    </div>
                    <button
                      onClick={handleApplySuggestions}
                      className="px-3 py-1.5 text-[11px] bg-accent hover:bg-accent-hover text-white rounded transition-colors shrink-0"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'android' && (
            <>
              <FormField
                label="Package name (Chat App)"
                value={config.chatAppPackage}
                onChange={(v) => update('chatAppPackage', v)}
                placeholder="com.miempresa.fichas"
                error={errors.chatAppPackage}
              />
              <FormField
                label="Package name (Operator Mobile)"
                value={config.operatorMobilePackage}
                onChange={(v) => update('operatorMobilePackage', v)}
                placeholder="com.miempresa.operator"
                error={errors.operatorMobilePackage}
              />
              <FormField
                label="Deep link scheme"
                value={config.deepLinkScheme}
                onChange={(v) => update('deepLinkScheme', v)}
                placeholder="mifichas"
              />
              <FormField
                label="Nombre display (Chat App)"
                value={config.chatAppDisplayName}
                onChange={(v) => update('chatAppDisplayName', v)}
                placeholder="Las Vegas Fichas"
              />
              <FormField
                label="Nombre display (Operator)"
                value={config.operatorAppDisplayName}
                onChange={(v) => update('operatorAppDisplayName', v)}
                placeholder="Operator Panel"
              />
            </>
          )}

          {activeTab === 'urls' && (
            <>
              <FormField
                label="API URL"
                value={config.apiUrl}
                onChange={(v) => update('apiUrl', v)}
                type="url"
                placeholder="https://mi-api.onrender.com"
                error={errors.apiUrl}
                required
              />
              <FormField
                label="Landing URL"
                value={config.landingUrl}
                onChange={(v) => update('landingUrl', v)}
                type="url"
                placeholder="https://mi-landing.onrender.com"
              />
              <FormField
                label="Chat Web URL"
                value={config.chatWebUrl}
                onChange={(v) => update('chatWebUrl', v)}
                type="url"
                placeholder="https://mi-chat-web.onrender.com"
              />
              <FormField
                label="URL del panel de juego"
                value={config.gamePanelUrl}
                onChange={(v) => update('gamePanelUrl', v)}
                type="url"
                placeholder="https://mipanel.com"
                error={errors.gamePanelUrl}
                required
              />
              <FormField
                label="URL del admin panel"
                value={config.adminPanelUrl}
                onChange={(v) => update('adminPanelUrl', v)}
                type="url"
                placeholder="https://admin.mipanel.com"
              />
            </>
          )}

          {activeTab === 'credentials' && (
            <>
              <FormField
                label="Contraseña default del panel"
                value={config.defaultPanelPassword}
                onChange={(v) => update('defaultPanelPassword', v)}
                type="password"
                placeholder="Contraseña para nuevos usuarios del casino"
              />
              <FormField
                label="Bot API Key"
                value={config.botApiKey}
                onChange={(v) => update('botApiKey', v)}
                type="password"
                placeholder="Clave compartida con la Chrome Extension"
                error={errors.botApiKey}
                required
              />
              <FormField
                label="Operator API Key"
                value={config.operatorApiKey}
                onChange={(v) => update('operatorApiKey', v)}
                type="password"
                placeholder="Clave para el panel de operadores"
              />
              <FormField
                label="Validator API Key"
                value={config.validatorApiKey}
                onChange={(v) => update('validatorApiKey', v)}
                type="password"
                placeholder="Clave para la app validadora"
              />
              <FormField
                label="JWT Secret"
                value={config.jwtSecret}
                onChange={(v) => update('jwtSecret', v)}
                type="password"
                placeholder="openssl rand -base64 32"
                error={errors.jwtSecret}
                required
              />

              {/* Generate all credentials */}
              <div className="mt-2 p-3 bg-green-950/20 border border-green-900/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-green-400">Generar credenciales</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Genera claves aleatorias para los campos vacios
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateCredentials}
                    className="px-3 py-1.5 text-[11px] bg-green-700 hover:bg-green-600 text-white rounded transition-colors shrink-0"
                  >
                    Generar
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'theme' && (
            <ThemeTab
              theme={config.theme}
              onUpdate={updateTheme}
              appName={config.shortName || config.businessName}
            />
          )}

          {activeTab === 'bot' && (
            <>
              <FormField
                label="AI Persona"
                value={config.aiPersona}
                onChange={(v) => update('aiPersona', v)}
                type="textarea"
                placeholder="Sos un asistente amigable de [nombre]..."
                rows={6}
              />
              <FormField
                label="Mensaje de transferencia de premio"
                value={config.prizeTransferMessage}
                onChange={(v) => update('prizeTransferMessage', v)}
                type="textarea"
                placeholder="Tu premio fue transferido! Gracias por jugar en [nombre]!"
                rows={3}
              />
              <FormField
                label="Prefijo de promo en Telegram"
                value={config.telegramPromoPrefix}
                onChange={(v) => update('telegramPromoPrefix', v)}
                placeholder="📢 Mi Casino"
              />
            </>
          )}

          {activeTab === 'server' && (
            <>
              <FormField
                label="Usuario VPS"
                value={config.vpsUser}
                onChange={(v) => update('vpsUser', v)}
                placeholder="micasino"
              />
              <FormField
                label="Directorio home"
                value={config.homeDirectory}
                onChange={(v) => update('homeDirectory', v)}
                placeholder="/opt/micasino"
              />
              <FormField
                label="Prefijo de servicios"
                value={config.servicePrefix}
                onChange={(v) => update('servicePrefix', v)}
                placeholder="micasino"
              />
              <FormField
                label="Docker registry"
                value={config.dockerRegistry}
                onChange={(v) => update('dockerRegistry', v)}
                placeholder="username"
              />
              <FormField
                label="Docker image prefix"
                value={config.dockerImagePrefix}
                onChange={(v) => update('dockerImagePrefix', v)}
                placeholder="micasino"
              />

              {/* Deployment-specific fields */}
              <div className="mt-4 pt-4 border-t border-border">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Configuracion de Deploy</h3>
                <div className="space-y-4">
                  <FormField
                    label="Database URL"
                    value={config.deployment?.databaseUrl || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), databaseUrl: v } })}
                    type="password"
                    placeholder="postgresql://user:pass@host:5432/db"
                  />
                  <FormField
                    label="Cloudinary URL"
                    value={config.deployment?.cloudinaryUrl || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), cloudinaryUrl: v } })}
                    type="password"
                    placeholder="cloudinary://key:secret@cloud"
                  />
                  <FormField
                    label="Monitoring API Key"
                    value={config.monitoringApiKey}
                    onChange={(v) => update('monitoringApiKey', v)}
                    type="password"
                    placeholder="Key para Client Manager monitoring"
                  />
                  <FormField
                    label="Telegram Bot Token"
                    value={config.deployment?.telegramBotToken || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), telegramBotToken: v } })}
                    type="password"
                    placeholder="Token de @BotFather"
                  />
                  <FormField
                    label="Telegram Chat ID"
                    value={config.deployment?.telegramChatId || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), telegramChatId: v } })}
                    placeholder="ID del grupo/chat"
                  />
                  <FormField
                    label="Render Service ID (API)"
                    value={config.deployment?.renderServiceIds?.api || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), renderServiceIds: { ...(config.deployment?.renderServiceIds || { api: '', chatWeb: '', landing: '' }), api: v } } })}
                    placeholder="srv-xxxxx"
                  />
                  <FormField
                    label="Render Service ID (Chat Web)"
                    value={config.deployment?.renderServiceIds?.chatWeb || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), renderServiceIds: { ...(config.deployment?.renderServiceIds || { api: '', chatWeb: '', landing: '' }), chatWeb: v } } })}
                    placeholder="srv-xxxxx"
                  />
                  <FormField
                    label="Render Service ID (Landing)"
                    value={config.deployment?.renderServiceIds?.landing || ''}
                    onChange={(v) => updateConfig({ deployment: { ...(config.deployment || EMPTY_DEPLOYMENT), renderServiceIds: { ...(config.deployment?.renderServiceIds || { api: '', chatWeb: '', landing: '' }), landing: v } } })}
                    placeholder="srv-xxxxx"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'assets' && id && (
            <AssetManager
              clientId={id}
              assets={editorAssets}
              onAssetsChange={() => { if (id) loadClientForEditing(id) }}
            />
          )}

          {activeTab === 'commissions' && id && (
            <CommissionEditor clientId={id} config={config} />
          )}

          {activeTab === 'deploy' && (
            <DeployTools config={config} />
          )}
        </div>
      </div>

      {/* Save Summary Dialog */}
      <SaveSummary
        open={showSaveSummary}
        config={config}
        profile={editorProfile}
        assets={editorAssets}
        saving={saving}
        onConfirm={handleSaveConfirm}
        onCancel={() => setShowSaveSummary(false)}
      />
    </div>
  )
}

// --- Tab fill level calculator ---

function getTabFillLevel(tabId: string, config: ClientConfig, assets: string[]): 'full' | 'partial' | 'empty' {
  const checks: Record<string, string[]> = {
    identity: ['id', 'businessName', 'shortName', 'description'],
    android: ['chatAppPackage', 'operatorMobilePackage', 'deepLinkScheme', 'chatAppDisplayName'],
    urls: ['apiUrl', 'landingUrl', 'chatWebUrl', 'gamePanelUrl', 'adminPanelUrl'],
    credentials: ['defaultPanelPassword', 'botApiKey', 'operatorApiKey', 'validatorApiKey', 'jwtSecret'],
    theme: [], // always "full" since it has defaults
    bot: ['aiPersona', 'prizeTransferMessage', 'telegramPromoPrefix'],
    server: ['vpsUser', 'homeDirectory', 'servicePrefix', 'dockerRegistry', 'dockerImagePrefix'],
    commissions: [], // handled externally
    deploy: [], // handled separately
    assets: [], // handled separately
  }

  if (tabId === 'theme') return 'full'
  if (tabId === 'commissions') return 'full' // managed externally
  if (tabId === 'deploy') {
    const d = config.deployment
    if (d?.databaseUrl && d?.cloudinaryUrl) return 'full'
    if (d?.databaseUrl || d?.cloudinaryUrl || config.monitoringApiKey) return 'partial'
    return 'empty'
  }
  if (tabId === 'assets') {
    if (assets.length >= 3) return 'full'
    if (assets.length > 0) return 'partial'
    return 'empty'
  }

  const fields = checks[tabId] || []
  const filled = fields.filter(f => !!(config as any)[f])

  if (filled.length === fields.length) return 'full'
  if (filled.length > 0) return 'partial'
  return 'empty'
}

// --- Theme Tab with color pickers + phone preview ---

function ThemeTab({
  theme,
  onUpdate,
  appName,
}: {
  theme: ThemeConfig
  onUpdate: (field: keyof ThemeConfig, value: string) => void
  appName: string
}) {
  const [activeColor, setActiveColor] = useState<keyof ThemeConfig | null>(null)

  const colors: { key: keyof ThemeConfig; label: string }[] = [
    { key: 'primaryColor', label: 'Primario' },
    { key: 'accentColor', label: 'Acento' },
    { key: 'backgroundColor', label: 'Fondo' },
    { key: 'textColor', label: 'Texto' },
    { key: 'headerColor', label: 'Header' },
    { key: 'errorColor', label: 'Error' },
    { key: 'successColor', label: 'Éxito' },
  ]

  return (
    <div className="flex gap-6">
      {/* Left: color pickers */}
      <div className="flex-1 space-y-4">
        {/* Color buttons */}
        <div className="grid grid-cols-2 gap-3">
          {colors.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveColor(activeColor === key ? null : key)}
              className={`flex items-center gap-3 p-3 rounded border transition-colors text-left ${
                activeColor === key
                  ? 'border-accent bg-surface-2'
                  : 'border-border bg-surface-1 hover:border-border-light'
              }`}
            >
              <div
                className="w-8 h-8 rounded border border-border shrink-0"
                style={{ backgroundColor: theme[key] }}
              />
              <div>
                <div className="text-xs font-medium text-gray-300">{label}</div>
                <div className="text-[10px] text-gray-500 font-mono">{theme[key]}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Active color picker */}
        {activeColor && (
          <div className="p-4 bg-surface-2 border border-border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-300">
                {colors.find((c) => c.key === activeColor)?.label}
              </span>
              <input
                type="text"
                value={theme[activeColor]}
                onChange={(e) => onUpdate(activeColor, e.target.value)}
                className="w-24 bg-surface-3 border border-border rounded px-2 py-1 text-xs text-gray-300 font-mono text-center"
              />
            </div>
            <HexColorPicker
              color={theme[activeColor]}
              onChange={(color) => onUpdate(activeColor, color)}
              style={{ width: '100%', height: 180 }}
            />
          </div>
        )}
      </div>

      {/* Right: phone mockup preview */}
      <div className="w-[260px] shrink-0">
        <ThemePreview theme={theme} appName={appName} />
      </div>
    </div>
  )
}

// --- Helper ---

function getTabForField(field: string): TabId | null {
  const fieldToTab: Record<string, TabId> = {
    id: 'identity',
    businessName: 'identity',
    shortName: 'identity',
    chatAppPackage: 'android',
    operatorMobilePackage: 'android',
    apiUrl: 'urls',
    gamePanelUrl: 'urls',
    landingUrl: 'urls',
    chatWebUrl: 'urls',
    adminPanelUrl: 'urls',
    botApiKey: 'credentials',
    jwtSecret: 'credentials',
    defaultPanelPassword: 'credentials',
  }
  return fieldToTab[field] || null
}
