import { defineConfig } from "vite";

// The studio serves the built game under /preview/<session>/ — never at the
// origin root — so every asset reference must be relative to the page. With
// the default base ("/") the page loads but its script 404s, which a player
// experiences as a game that will not start.
export default defineConfig({
  base: "./",
});
