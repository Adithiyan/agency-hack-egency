/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./web/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        ink:    { 50:'#F8FAFC', 100:'#F1F5F9', 200:'#E2E8F0', 300:'#CBD5E1', 400:'#94A3B8', 500:'#64748B', 700:'#334155', 800:'#1E293B', 900:'#0F172A' },
        brand:  { 50:'#EFF6FF', 100:'#DBEAFE', 400:'#60A5FA', 500:'#3B82F6', 600:'#2563EB', 700:'#1D4ED8', 900:'#1E3A8A' },
        accent: { 50:'#FFFBEB', 400:'#FBBF24', 500:'#F59E0B', 600:'#D97706' },
        danger: { 50:'#FEF2F2', 100:'#FEE2E2', 400:'#F87171', 500:'#EF4444', 700:'#B91C1C', 800:'#991B1B' },
        warn:   { 50:'#FFFBEB', 400:'#FBBF24', 500:'#F59E0B' },
        ok:     { 50:'#ECFDF5', 400:'#34D399', 500:'#10B981', 700:'#047857' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
