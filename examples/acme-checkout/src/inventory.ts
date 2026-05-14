import type { CartItem } from "./cart.js";

export type Reservation = {
  orderId: string;
  sku: string;
  quantity: number;
};

export class InventoryService {
  private readonly reservations: Reservation[] = [];

  async reserve(orderId: string, items: CartItem[]): Promise<Reservation[]> {
    const reservations = items.map((item) => ({
      orderId,
      sku: item.sku,
      quantity: item.quantity
    }));

    this.reservations.push(...reservations);
    return reservations;
  }

  listReservations(orderId: string): Reservation[] {
    return this.reservations.filter((reservation) => reservation.orderId === orderId);
  }
}

