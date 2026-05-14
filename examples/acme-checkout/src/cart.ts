export type CartItem = {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type CartSummary = {
  subtotalCents: number;
  itemCount: number;
};

export function summarizeCart(items: CartItem[]): CartSummary {
  return items.reduce<CartSummary>(
    (summary, item) => ({
      subtotalCents: summary.subtotalCents + item.quantity * item.unitPriceCents,
      itemCount: summary.itemCount + item.quantity
    }),
    { subtotalCents: 0, itemCount: 0 }
  );
}

