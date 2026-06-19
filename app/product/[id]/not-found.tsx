import Link from "next/link";

export default function ProductNotFound() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Produto não encontrado</h1>
      <p className="mt-2 text-gray-600">
        O produto que você procura não existe no catálogo.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Voltar ao catálogo
      </Link>
    </div>
  );
}
