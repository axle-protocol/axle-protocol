import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        pact: {
          dark: '#0a0e17',
          card: '#111827',
          border: '#1f2937',
          accent: '#06b6d4',
          green: '#10b981',
          yellow: '#f59e0b',
          red: '#ef4444',
          purple: '#8b5cf6',
        },
      },
    },
  },
  plugins: [],
};
export default config;
