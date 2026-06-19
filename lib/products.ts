import productsData from "@/data/products.json";

export interface Product {
  id: string;
  title: string;
  category: string;
  description: string;
}

const products: Product[] = productsData;

export function getAllProducts(): Product[] {
  return products;
}

export function getProductById(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}
