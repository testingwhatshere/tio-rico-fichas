import { useEffect, useRef } from 'react'
import { useWizardStore } from './useWizardStore'
import { generateDerivedFields } from '@/lib/autofill'

export function useAutoSuggest() {
  const businessName = useWizardStore((s) => s.businessName)
  const shortName = useWizardStore((s) => s.shortName)
  const description = useWizardStore((s) => s.description)
  const telegramPromoPrefix = useWizardStore((s) => s.telegramPromoPrefix)
  const autoSuggestedFields = useWizardStore((s) => s.autoSuggestedFields)
  const setField = useWizardStore((s) => s.setField)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      if (!businessName.trim()) return

      const derived = generateDerivedFields(businessName)

      // Only auto-fill if field is empty or was auto-suggested before
      if (!shortName || autoSuggestedFields.includes('shortName')) {
        setField('shortName', derived.shortName || '')
      }
      if (!description || autoSuggestedFields.includes('description')) {
        setField('description', derived.description || '')
      }
      if (!telegramPromoPrefix || autoSuggestedFields.includes('telegramPromoPrefix')) {
        setField('telegramPromoPrefix', derived.telegramPromoPrefix || '')
      }

      // Track which fields were auto-suggested
      const newAutoFields = new Set(autoSuggestedFields)
      if (!shortName) newAutoFields.add('shortName')
      if (!description) newAutoFields.add('description')
      if (!telegramPromoPrefix) newAutoFields.add('telegramPromoPrefix')

      useWizardStore.setState({ autoSuggestedFields: [...newAutoFields] })
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [businessName]) // eslint-disable-line react-hooks/exhaustive-deps
}
