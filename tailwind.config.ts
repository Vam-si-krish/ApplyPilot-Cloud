import type { Config } from 'tailwindcss';

// Theme ported verbatim from ApplyPilot-Lite/ui/tailwind.config.js so the
// Cloud UI matches the existing dark "void/sky" look and feel (ADR 0002).
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body: ['Outfit', 'sans-serif'],
        mono: ['"Fira Code"', 'monospace'],
      },
      colors: {
        void: '#070711',
        base: '#0c0c1c',
        card: '#101020',
        raised: '#14142a',
        ink: {
          DEFAULT: '#1e1e38',
          subtle: '#161628',
        },
        sky: {
          DEFAULT: '#38bdf8',
          dim: '#0ea5e9',
          glow: 'rgba(56,189,248,0.12)',
        },
        emerald: { DEFAULT: '#34d399' },
        amber: { DEFAULT: '#fbbf24' },
        rose: { DEFAULT: '#f87171' },
        slate: {
          text: '#e2e8f0',
          muted: '#64748b',
          dim: '#334155',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
