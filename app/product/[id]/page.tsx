import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductById } from "@/lib/products";

interface ProductPageProps {
  params: { id: string };
}

export default function ProductPage({ params }: ProductPageProps) {
  const product = getProductById(params.id);

  if (!product) {
    notFound();
  }

  return (
    <div>
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Voltar ao catálogo
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{product.title}</h1>

      {/* Dados crus do produto */}
      <dl className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div>
          <dt className="font-medium text-gray-500">ID</dt>
          <dd>{product.id}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Categoria</dt>
          <dd>{product.category}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Descrição</dt>
          <dd>{product.description}</dd>
        </div>
      </dl>

      {/*
        ProductAIWidget entra aqui na Etapa 4 (junto com a API):
        <ProductAIWidget
          productId={product.id}
          productTitle={product.title}
          productDescription={product.description}
          category={product.category}
        />
      */}
    </div>
  );
}
