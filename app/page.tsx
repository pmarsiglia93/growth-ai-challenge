import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { getAllProducts } from "@/lib/products";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  const products = getAllProducts();

  return (
    <div>
      <header className="mb-8">
        <Badge variant="ai" className="mb-3">
          <Sparkles aria-hidden="true" className="h-3 w-3" />
          Growth AI
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">Catálogo</h1>
        <p className="mt-2 text-slate-600">
          Selecione um produto para ver o widget de enriquecimento com IA.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {products.map((product) => (
          <li key={product.id}>
            <Link
              href={`/product/${product.id}`}
              className="group flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
            >
              <div>
                <span className="block font-semibold leading-snug">
                  {product.title}
                </span>
                <Badge variant="secondary" className="mt-2">
                  {product.category}
                </Badge>
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-700">
                Ver produto
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
