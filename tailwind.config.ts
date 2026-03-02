import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#F55D3E",
          secondary: "#878E88",
          accent: "#F7CB15",
        },
      },
    },
  },
  plugins: [],
};

export default config;
