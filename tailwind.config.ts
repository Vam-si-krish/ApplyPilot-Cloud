import type { Config } from 'tailwindcss';

// Design system v2 ("aurora console") — evolved from the Lite "void/sky" theme
// (ADR 0002). Token *names* are unchanged so every page keeps compiling; the
// values are richer: blue-violet dark surfaces, brighter muted text for
// readability, a secondary `iris` accent for gradients, and layered shadows.
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  // Accent classes are built at runtime (`text-${color}`), so Tailwind can't see
  // them in source — safelist the variants used by stat cards / charts.
  safelist: [
    'text-sky',
    'text-amber',
    'text-emerald',
    'text-rose',
    'text-iris',
    'bg-sky',
    'bg-amber',
    'bg-emerald',
    'bg-rose',
    'bg-iris',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        void: '#06070f',
        base: '#0a0c17',
        card: '#0e111e',
        raised: '#161a2e',
        ink: {
          DEFAULT: '#232946',
          subtle: '#171b2f',
        },
        sky: {
          DEFAULT: '#38bdf8',
          dim: '#0ea5e9',
          glow: 'rgba(56,189,248,0.12)',
        },
        iris: {
          DEFAULT: '#8b93ff',
          glow: 'rgba(139,147,255,0.12)',
        },
        emerald: { DEFAULT: '#34d399' },
        amber: { DEFAULT: '#fbbf24' },
        rose: { DEFAULT: '#fb7185' },
        slate: {
          text: '#e8ecf8',
          muted: '#8e97b8',
          dim: '#454e73',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.5)',
        pop: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 48px -16px rgba(0,0,0,0.65)',
        'glow-sky': '0 0 32px -4px rgba(56,189,248,0.35)',
        'glow-emerald': '0 0 32px -4px rgba(52,211,153,0.35)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
