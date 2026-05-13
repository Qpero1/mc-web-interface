/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefaf2',
          100: '#d6f3df',
          200: '#aee6bf',
          300: '#7dd49a',
          400: '#4cc176',
          500: '#2aa75d',
          600: '#1f8949',
          700: '#1b6c3c',
          800: '#175533',
          900: '#12422a',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        'progress': 'progress linear forwards',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'slide-up': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'progress': { '0%': { width: '100%' }, '100%': { width: '0%' } },
      },
    },
  },
  plugins: [],
};
