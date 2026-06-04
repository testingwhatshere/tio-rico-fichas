import { create } from 'zustand'
import type { ClientConfig, ClientSummary, PanelProfile } from '../lib/types'
import { EMPTY_CONFIG } from '../lib/types'

interface ClientStore {
  clients: ClientSummary[]
  loading: boolean
  error: string | null

  // Editor state
  editorConfig: ClientConfig
  editorProfile: PanelProfile | null
  editorAssets: string[]
  isDirty: boolean
  saving: boolean
  /** Tracks which client ID is being loaded — discards stale responses on rapid switching */
  _loadingClientId: string | null

  // Actions
  fetchClients: () => Promise<void>
  loadClientForEditing: (id: string) => Promise<void>
  updateConfig: (partial: Partial<ClientConfig>) => void
  updateProfile: (profile: PanelProfile | null) => void
  saveCurrentClient: () => Promise<{ success: boolean; path?: string; error?: string }>
  resetEditor: () => void
  setDirty: (dirty: boolean) => void
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: [],
  loading: false,
  error: null,

  editorConfig: { ...EMPTY_CONFIG },
  editorProfile: null,
  editorAssets: [],
  isDirty: false,
  saving: false,
  _loadingClientId: null,

  fetchClients: async () => {
    set({ loading: true, error: null })
    try {
      const clients = await window.api.listClients()
      set({ clients, loading: false })
    } catch (e: any) {
      set({ error: e.message, loading: false })
    }
  },

  loadClientForEditing: async (id: string) => {
    set({ loading: true, error: null, _loadingClientId: id })
    try {
      const data = await window.api.loadClient(id)
      // Guard: if user switched to a different client while loading, discard this response
      if (get()._loadingClientId !== id) return
      set({
        editorConfig: { ...EMPTY_CONFIG, ...data.config },
        editorProfile: data.profile,
        editorAssets: data.assets,
        isDirty: false,
        loading: false,
        _loadingClientId: null,
      })
    } catch (e: any) {
      if (get()._loadingClientId !== id) return
      set({ error: e.message, loading: false, _loadingClientId: null })
    }
  },

  updateConfig: (partial) => {
    const current = get().editorConfig
    set({ editorConfig: { ...current, ...partial }, isDirty: true })
  },

  updateProfile: (profile) => {
    set({ editorProfile: profile, isDirty: true })
  },

  saveCurrentClient: async () => {
    const { editorConfig, editorProfile } = get()
    if (!editorConfig.id) return { success: false, error: 'Missing client ID' }

    set({ saving: true })
    try {
      const result = await window.api.saveClient(editorConfig.id, editorConfig, editorProfile)
      set({ saving: false, isDirty: false })
      return result
    } catch (e: any) {
      set({ saving: false })
      return { success: false, error: e.message }
    }
  },

  resetEditor: () => {
    set({
      editorConfig: { ...EMPTY_CONFIG },
      editorProfile: null,
      editorAssets: [],
      isDirty: false,
    })
  },

  setDirty: (dirty) => set({ isDirty: dirty }),
}))
