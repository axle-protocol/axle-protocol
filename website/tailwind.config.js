/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'axle-blue': '#0066FF',
        'axle-purple': '#8B5CF6',
        'axle-cyan': '#00D9FF',
        'axle-dark': '#0A0A0B',
        'axle-gray': '#1A1A1B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-gradient': 'linear-gradient(135deg, #0066FF 0%, #8B5CF6 100%)',
      },
    },
  },
  plugins: [],
}
