export type PaymentAuthorizationRequest = {
  orderId: string;
  amountCents: number;
  paymentToken: string;
};

export type PaymentAuthorization = {
  authorizationId: string;
  orderId: string;
  amountCents: number;
};

export interface PaymentGateway {
  authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorization>;
}

export class FakePaymentGateway implements PaymentGateway {
  async authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorization> {
    return {
      authorizationId: `auth_${request.orderId}`,
      orderId: request.orderId,
      amountCents: request.amountCents
    };
  }
}

