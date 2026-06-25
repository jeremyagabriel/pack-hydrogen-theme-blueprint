import {useCallback} from 'react';
import type {CartLine} from '@shopify/hydrogen/storefront-api-types';

import {useCart} from '~/hooks';

export const useCartLine = ({line}: {line: CartLine}) => {
  const {id, quantity} = {...line};
  const {flushPendingCartUpdates, isSyncingCart, setLineQuantity} = useCart();

  // `quantity` here is already the optimistic quantity (the overlay is merged
  // into useCart().lines), so incrementing off it keeps rapid clicks correct.
  const handleDecrement = useCallback(() => {
    // A quantity of 0 is routed to a line removal by the flush.
    setLineQuantity(id, Math.max(0, quantity - 1));
  }, [id, quantity, setLineQuantity]);

  const handleIncrement = useCallback(() => {
    setLineQuantity(id, quantity + 1);
  }, [id, quantity, setLineQuantity]);

  const handleRemove = useCallback(() => {
    // Removing via the X is a deliberate action — apply it immediately rather
    // than waiting out the debounce window.
    setLineQuantity(id, 0);
    void flushPendingCartUpdates();
  }, [id, flushPendingCartUpdates, setLineQuantity]);

  return {
    handleDecrement,
    handleIncrement,
    handleRemove,
    isSyncingCart,
  };
};
