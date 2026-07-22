import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e5ff",
          500: "#3b6fe0",
          600: "#2f57c4",
          700: "#274aa6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
