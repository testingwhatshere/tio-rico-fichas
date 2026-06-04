import jsPDF from 'jspdf'
import type { OnboardingFormData } from '@/lib/types'
import { THEME_LABELS } from '@/lib/types'
import { toSlug } from '@/lib/autofill'
import type { ThemeConfig } from '@/lib/types'

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

export function generatePdf(data: OnboardingFormData) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = 210
  const margin = 20
  const contentWidth = pageWidth - margin * 2
  let y = 20

  // Dark background
  doc.setFillColor(15, 15, 15)
  doc.rect(0, 0, 210, 297, 'F')

  // Header
  doc.setFontSize(22)
  doc.setTextColor(201, 152, 58) // accent color
  doc.text('Configuración de Plataforma', margin, y)
  y += 10

  doc.setFontSize(10)
  doc.setTextColor(160, 160, 160)
  doc.text(`Generado el ${new Date().toLocaleDateString('es-AR')}`, margin, y)
  y += 15

  // Section helper
  function section(title: string) {
    checkPageBreak(25)
    y += 5
    doc.setFillColor(30, 30, 30)
    doc.roundedRect(margin, y - 4, contentWidth, 8, 1, 1, 'F')
    doc.setFontSize(11)
    doc.setTextColor(201, 152, 58)
    doc.text(title, margin + 4, y + 1.5)
    y += 12
  }

  function checkPageBreak(needed: number) {
    if (y + needed > 275) {
      doc.addPage()
      y = 20
      doc.setFillColor(15, 15, 15)
      doc.rect(0, 0, 210, 297, 'F')
    }
  }

  function field(label: string, value: string) {
    if (!value) return
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(value, contentWidth - 4)
    const neededHeight = 4 + lines.length * 4.5 + 3
    checkPageBreak(neededHeight + 4)

    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(label, margin + 2, y)
    doc.setFontSize(10)
    doc.setTextColor(220, 220, 220)
    doc.text(lines, margin + 2, y + 4)
    y += neededHeight
  }

  // --- Identity ---
  section('Identidad del Negocio')
  field('Nombre del negocio', data.businessName)
  field('Nombre corto', data.shortName)
  field('Descripción', data.description)
  field('Contacto', data.contactName)

  // --- URLs ---
  section('URLs y Panel')
  field('Panel de juego', data.gamePanelUrl)
  field('Panel admin', data.adminPanelUrl)
  field('Landing page', data.landingUrl)
  field('Chat web', data.chatWebUrl)

  // --- Theme colors ---
  section('Colores del Tema')
  const colorKeys = Object.keys(THEME_LABELS) as (keyof ThemeConfig)[]
  const swatchSize = 8
  const swatchGap = 2
  const colsPerRow = 4
  let col = 0

  colorKeys.forEach((key) => {
    const x = margin + 2 + col * ((contentWidth - 4) / colsPerRow)
    const rgb = hexToRgb(data.theme[key])
    doc.setFillColor(rgb[0], rgb[1], rgb[2])
    doc.roundedRect(x, y, swatchSize, swatchSize, 1, 1, 'F')
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 160)
    doc.text(THEME_LABELS[key], x + swatchSize + 2, y + 3)
    doc.setTextColor(100, 100, 100)
    doc.text(data.theme[key], x + swatchSize + 2, y + 6.5)

    col++
    if (col >= colsPerRow) {
      col = 0
      y += swatchSize + swatchGap + 6
    }
  })
  if (col > 0) y += swatchSize + swatchGap + 6

  // --- Personalization ---
  section('Personalización')
  field('Personalidad del bot', data.aiPersona)
  field('Mensaje de premios', data.prizeTransferMessage)
  field('Prefijo Telegram', data.telegramPromoPrefix)

  // Footer
  const footerY = 290
  doc.setFontSize(7)
  doc.setTextColor(80, 80, 80)
  doc.text('Documento generado por el portal de configuración', margin, footerY)

  const slug = toSlug(data.businessName) || 'cliente'
  doc.save(`configuracion-${slug}.pdf`)
}
