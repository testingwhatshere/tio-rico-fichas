import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OnboardingFormData, ThemeConfig } from '@/lib/types'
import { EMPTY_FORM } from '@/lib/types'

interface WizardState extends OnboardingFormData {
  currentStep: number
  autoSuggestedFields: string[]

  setField: <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) => void
  setThemeColor: (key: keyof ThemeConfig, value: string) => void
  goToStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  markManualEdit: (field: string) => void
  reset: () => void
  getFormData: () => OnboardingFormData
}

export const useWizardStore = create<WizardState>()(
  persist(
    (set, get) => ({
      ...EMPTY_FORM,
      currentStep: 0,
      autoSuggestedFields: [],

      setField: (key, value) => set({ [key]: value }),

      setThemeColor: (key, value) =>
        set((s) => ({ theme: { ...s.theme, [key]: value } })),

      goToStep: (step) => set({ currentStep: Math.max(0, Math.min(4, step)) }),
      nextStep: () => set((s) => ({ currentStep: Math.min(4, s.currentStep + 1) })),
      prevStep: () => set((s) => ({ currentStep: Math.max(0, s.currentStep - 1) })),

      markManualEdit: (field) =>
        set((s) => ({
          autoSuggestedFields: s.autoSuggestedFields.filter((f) => f !== field),
        })),

      reset: () => set({ ...EMPTY_FORM, currentStep: 0, autoSuggestedFields: [] }),

      getFormData: () => {
        const s = get()
        return {
          businessName: s.businessName,
          shortName: s.shortName,
          description: s.description,
          contactName: s.contactName,
          gamePanelUrl: s.gamePanelUrl,
          adminPanelUrl: s.adminPanelUrl,
          landingUrl: s.landingUrl,
          chatWebUrl: s.chatWebUrl,
          theme: s.theme,
          aiPersona: s.aiPersona,
          prizeTransferMessage: s.prizeTransferMessage,
          telegramPromoPrefix: s.telegramPromoPrefix,
        }
      },
    }),
    { name: 'onboarding-wizard' }
  )
)
