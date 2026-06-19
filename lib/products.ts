import productsData from "@/data/products.json";
import type { Product } from "@/lib/types";

export type { Product };

const products: Product[] = productsData;

export function getAllProducts(): Product[] {
  return products;
}

export function getProductById(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}
