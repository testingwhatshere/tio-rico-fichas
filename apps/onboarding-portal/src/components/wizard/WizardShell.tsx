'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useWizardStore } from '@/hooks/useWizardStore'
import { validateStep } from '@/lib/validation'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { StepIdentity } from './StepIdentity'
import { StepUrls } from './StepUrls'
import { StepBranding } from './StepBranding'
import { StepPersonalization } from './StepPersonalization'
import { SummaryScreen } from './SummaryScreen'

const stepComponents = [StepIdentity, StepUrls, StepBranding, StepPersonalization]

export function WizardShell() {
  const currentStep = useWizardStore((s) => s.currentStep)
  const nextStep = useWizardStore((s) => s.nextStep)
  const prevStep = useWizardStore((s) => s.prevStep)
  const goToStep = useWizardStore((s) => s.goToStep)
  const getFormData = useWizardStore((s) => s.getFormData)
  const reset = useWizardStore((s) => s.reset)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [direction, setDirection] = useState(1)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  const isSummary = currentStep === 4

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleNext() {
    const formData = getFormData()
    const stepErrors = validateStep(currentStep, formData)

    if (stepErrors.length > 0) {
      const errorMap: Record<string, string> = {}
      stepErrors.forEach((e) => (errorMap[e.field] = e.message))
      setErrors(errorMap)
      return
    }

    setErrors({})
    setDirection(1)
    nextStep()
    scrollToTop()
  }

  function handlePrev() {
    setErrors({})
    setDirection(-1)
    prevStep()
    scrollToTop()
  }

  function handleStepClick(step: number) {
    if (step < currentStep) {
      setErrors({})
      setDirection(-1)
      goToStep(step)
      scrollToTop()
    }
  }

  function handleStartOver() {
    reset()
    setErrors({})
    setDirection(-1)
    scrollToTop()
  }

  const StepComponent = isSummary ? null : stepComponents[currentStep]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-surface-1/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto py-4 px-4">
          <div className="text-center mb-4">
            <h1 className="text-lg font-semibold text-gray-200">Configurá tu plataforma</h1>
            <p className="text-xs text-gray-500 mt-0.5">Completá los datos y descargá tu configuración</p>
          </div>
          {!isSummary && <ProgressBar currentStep={currentStep} onStepClick={handleStepClick} />}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {isSummary ? (
              <SummaryScreen onStartOver={handleStartOver} />
            ) : (
              StepComponent && <StepComponent errors={errors} setErrors={setErrors} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer navigation */}
      {!isSummary && (
        <footer className="border-t border-border bg-surface-1/80 backdrop-blur-md sticky bottom-0 z-20">
          <div className="max-w-5xl mx-auto py-4 px-4 flex items-center justify-between">
            <Button variant="ghost" onClick={handlePrev} disabled={currentStep === 0}>
              Anterior
            </Button>
            <span className="text-xs text-gray-500">
              Paso {currentStep + 1} de 4
            </span>
            <Button onClick={handleNext}>
              {currentStep === 3 ? 'Ver resumen' : 'Siguiente'}
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}
