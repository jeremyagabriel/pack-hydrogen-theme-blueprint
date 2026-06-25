import type {
  Cart,
  CartBuyerIdentityInput,
  CartInput,
  CartLine,
  CartLineInput,
  CartLineUpdateInput,
  AttributeInput,
  UserError,
  CartWarning,
} from '@shopify/hydrogen/storefront-api-types';

import type {CartError, CartStatus} from './context.types';

export interface CartActionData {
  cart: Cart | null;
  userErrors: UserError[] | null;
  warnings: CartWarning[] | null;
}

export type CartWithActions = Omit<Cart, 'lines'> & {
  lines: CartLine[];
  cartCreate: (cartInput: CartInput) => Promise<CartActionData | null>;
  linesAdd: (lines: CartLineInput[]) => Promise<CartActionData | null>;
  linesUpdate: (lines: CartLineUpdateInput[]) => Promise<CartActionData | null>;
  linesRemove: (lineIds: string[]) => Promise<CartActionData | null>;
  discountCodesUpdate: (
    discountCodes: string[],
  ) => Promise<CartActionData | null>;
  cartAttributesUpdate: (
    attributes: AttributeInput[],
  ) => Promise<CartActionData | null>;
  buyerIdentityUpdate: (
    buyerIdentity: CartBuyerIdentityInput,
  ) => Promise<CartActionData | null>;
  noteUpdate: (note: string) => Promise<CartActionData | null>;
  /**
   * Optimistically set a cart line's quantity. The visible quantity updates
   * immediately; the real cart mutation is debounced and batched. Pass a
   * quantity of 0 to optimistically remove the line.
   */
  setLineQuantity: (lineId: string, quantity: number) => void;
  /**
   * Immediately flush any pending debounced line-quantity changes and resolve
   * once the resulting mutation(s) have settled. Call before checkout / unload.
   */
  flushPendingCartUpdates: () => Promise<void>;
  /** True while any optimistic line change is pending or in flight. */
  isSyncingCart: boolean;
  status: CartStatus;
  error: CartError;
};
