/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        // Soft "raised card" shadow, light mode.
        soft: '0 1px 2px rgba(17,24,39,0.03), 0 6px 20px rgba(17,24,39,0.05)',
        'soft-lg': '0 2px 6px rgba(17,24,39,0.04), 0 18px 44px rgba(17,24,39,0.09)',
        // Inset "pressed" look for toggles/wells.
        well: 'inset 0 1px 3px rgba(17,24,39,0.06)',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
