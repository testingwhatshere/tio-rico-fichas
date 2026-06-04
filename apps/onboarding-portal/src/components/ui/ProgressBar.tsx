import { STEPS } from '@/lib/types'

interface ProgressBarProps {
  currentStep: number
  onStepClick: (step: number) => void
}

export function ProgressBar({ currentStep, onStepClick }: ProgressBarProps) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 px-4">
      {STEPS.map((step, i) => {
        const isActive = i === currentStep
        const isCompleted = i < currentStep
        const isClickable = i <= currentStep

        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick(i)}
              disabled={!isClickable}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-300 ${
                isActive
                  ? 'bg-accent/15 border border-accent/40'
                  : isCompleted
                    ? 'bg-surface-2 border border-border cursor-pointer hover:border-accent/30'
                    : 'bg-surface-1 border border-transparent opacity-40'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-accent text-surface-0'
                    : isCompleted
                      ? 'bg-accent/30 text-accent'
                      : 'bg-surface-3 text-gray-500'
                }`}
              >
                {isCompleted ? '✓' : i + 1}
              </div>
              <div className="hidden md:block text-left">
                <div className={`text-xs font-medium ${isActive ? 'text-accent' : isCompleted ? 'text-gray-300' : 'text-gray-500'}`}>
                  {step.title}
                </div>
                <div className="text-[10px] text-gray-500">{step.subtitle}</div>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`w-4 sm:w-8 h-px mx-1 ${i < currentStep ? 'bg-accent/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
