import { summarizeCart, type CartItem } from "./cart.js";
import { InventoryService } from "./inventory.js";
import type { PaymentGateway } from "./payment.js";

export type CheckoutRequest = {
  orderId: string;
  customerId: string;
  items: CartItem[];
  paymentToken: string;
};

export type CheckoutReceipt = {
  orderId: string;
  customerId: string;
  totalCents: number;
  authorizedPaymentId: string;
};

export class CheckoutService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly payments: PaymentGateway
  ) {}

  async checkout(request: CheckoutRequest): Promise<CheckoutReceipt> {
    const cart = summarizeCart(request.items);
    await this.inventory.reserve(request.orderId, request.items);
    const authorization = await this.payments.authorize({
      orderId: request.orderId,
      amountCents: cart.subtotalCents,
      paymentToken: request.paymentToken
    });

    return {
      orderId: request.orderId,
      customerId: request.customerId,
      totalCents: cart.subtotalCents,
      authorizedPaymentId: authorization.authorizationId
    };
  }
}

