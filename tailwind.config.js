/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/frontend/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0D1B2A',
          light: '#16293F',
          lighter: '#1F3A57',
        },
        medical: '#F5F5F5',
        rx: {
          DEFAULT: '#2ECC71',
          dark: '#27AE60',
        },
        gold: {
          DEFAULT: '#F5A623',
          dark: '#D98F14',
        },
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
