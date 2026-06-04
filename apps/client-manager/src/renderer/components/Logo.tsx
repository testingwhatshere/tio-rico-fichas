interface LogoProps {
  size?: number
  showText?: boolean
}

/**
 * Aurum — Client Manager logo
 * Minimal geometric mark with a warm gold-to-amber gradient.
 */
export function Logo({ size = 24, showText = false }: LogoProps) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Rounded square with subtle gradient */}
        <rect width="32" height="32" rx="8" fill="url(#aurum-bg)" />

        {/* "A" letterform — clean, geometric */}
        <path
          d="M16 7L9 25h3.2l1.6-4.5h4.4L19.8 25H23L16 7z"
          fill="url(#aurum-letter)"
        />
        {/* Crossbar */}
        <path
          d="M12.4 18.5L16 9.5l3.6 9h-7.2z"
          fill="#1a1a1a"
          opacity="0.15"
        />

        <defs>
          <linearGradient id="aurum-bg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#2a2520" />
            <stop offset="100%" stopColor="#1a1714" />
          </linearGradient>
          <linearGradient id="aurum-letter" x1="12" y1="7" x2="20" y2="25">
            <stop offset="0%" stopColor="#d4a853" />
            <stop offset="50%" stopColor="#c9983a" />
            <stop offset="100%" stopColor="#a67c2e" />
          </linearGradient>
        </defs>
      </svg>

      {showText && (
        <div className="flex flex-col">
          <span className="text-sm font-bold text-gray-200 leading-none tracking-wide">Aurum</span>
          <span className="text-[7px] text-gray-600 leading-none mt-0.5 tracking-[0.2em] uppercase">Client Manager</span>
        </div>
      )}
    </div>
  )
}
