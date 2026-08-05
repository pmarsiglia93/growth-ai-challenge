import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAllProducts, getProductById } from "@/lib/products";
import ProductAIWidget from "@/components/ProductAIWidget";
import { Badge } from "@/components/ui/badge";

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

/** Pré-renderiza as 4 páginas de produto como estáticas (melhora TTFB/LCP). */
export function generateStaticParams() {
  return getAllProducts().map((product) => ({ id: product.id }));
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const product = getProductById(id);

  if (!product) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Voltar ao catálogo
      </Link>

      {/* Produto como herói */}
      <header className="mt-5">
        <Badge variant="secondary">{product.category}</Badge>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          {product.title}
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-slate-600">
          {product.description}
        </p>
        <p className="mt-2 text-xs text-slate-400">ID do produto: {product.id}</p>
      </header>

      <ProductAIWidget
        productId={product.id}
        productTitle={product.title}
        productDescription={product.description}
        category={product.category}
      />
    </div>
  );
}
