/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0a0a0a',
          1: '#111111',
          2: '#1a1a1a',
          3: '#222222',
          4: '#2a2a2a',
        },
        border: {
          DEFAULT: '#333333',
          light: '#444444',
        },
        accent: {
          DEFAULT: '#c9983a',
          hover: '#d4a853',
          muted: '#a67c2e',
        }
      }
    }
  },
  plugins: []
}
