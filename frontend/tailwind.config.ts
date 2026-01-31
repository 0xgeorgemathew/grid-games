import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './game/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      /* Animation durations (syncs with globals.css) */
      transitionDuration: {
        instant: '150ms',
        fast: '300ms',
        normal: '500ms',
        slow: '1s',
        slower: '2s',
        slowest: '4s',
      },
      /* Grid spacing (syncs with --grid-size in globals.css) */
      spacing: {
        grid: '60px',
      },
    },
  },
  plugins: [],
}

export default config
