/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les packages du monorepo sont consommés en source TypeScript : Next doit
  // les transpiler, sinon le build échoue sur du syntaxe TS non compilée.
  transpilePackages: ["@uac/contracts", "@uac/shared", "@uac/geospatial"],
  eslint: { ignoreDuringBuilds: true },
  /**
   * Les packages internes du monorepo importent leurs voisins avec l'extension
   * `.js` (convention NodeNext, correcte pour `tsc` et pour Node). Webpack ne
   * fait pas cette résolution tout seul : sans `extensionAlias`, tout build
   * échoue sur « Can't resolve './graph.js' ». On lui apprend donc à préférer
   * la source TypeScript avant le JavaScript compilé.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  },
};

export default nextConfig;
