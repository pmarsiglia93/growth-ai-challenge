import Link from "next/link";
import { getAllProducts } from "@/lib/products";

export default function HomePage() {
  const products = getAllProducts();

  return (
    <div>
      <h1 className="text-2xl font-bold">Catálogo</h1>
      <p className="mt-1 text-sm text-gray-600">
        Selecione um produto para ver o widget de enriquecimento com IA.
      </p>

      <ul className="mt-6 space-y-3">
        {products.map((product) => (
          <li key={product.id}>
            <Link
              href={`/product/${product.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-400 hover:shadow-sm"
            >
              <span className="font-medium">{product.title}</span>
              <span className="mt-1 block text-sm text-gray-500">
                {product.category}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
