import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Configurá tu plataforma',
  description: 'Personalizá tu plataforma de carga de fichas en minutos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
