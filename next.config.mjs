/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `npm run build` sempre executa o typecheck estrito no prebuild; evita que
  // o Next repita a mesma etapa dentro de um subprocesso.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Usa a API do TypeScript no processo do build; o CLI estrito já roda no prebuild.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
