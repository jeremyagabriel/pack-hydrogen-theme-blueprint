import {useCallback} from 'react';
import {CartForm, flattenConnection, useAnalytics} from '@shopify/hydrogen';
import {useCart as useClientSideCart} from '@shopify/hydrogen-react';
import type {CartBuyerIdentityInput} from '@shopify/hydrogen/storefront-api-types';

import {useCartContext} from '~/contexts/CartProvider/useCartContext';
import type {CartActionData, CartWithActions} from '~/lib/types';

import {useRootLoaderData} from '../useRootLoaderData';

/**
 * Module-level promise chain that serializes all cart mutations.
 * This prevents concurrent API calls from returning stale cart state
 * that overwrites the results of earlier mutations (e.g. rapidly
 * removing multiple cart lines).
 */
let mutationQueue: Promise<CartActionData | null> = Promise.resolve(null);

/**
 * Optimistic line-quantity machinery (module-level so it is shared across every
 * `useCart()` consumer and survives the cart drawer / individual cart lines
 * unmounting mid-edit).
 *
 * Clicking +/- writes the new quantity to the context overlay immediately for
 * an instant visual change, then schedules a debounced flush. All line changes
 * made within the debounce window are coalesced into a single batched mutation.
 * The server cart remains the source of truth — once a flush settles, the
 * overlay entries it covered are reconciled away (see `reconcileOptimisticLines`).
 */
const DEBOUNCE_MS = 300;

let pendingUpdates = new Map<string, {quantity: number; seq: number}>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let seqCounter = 0;

/**
 * The flush runs from a module-level timer, so it can't close over a specific
 * render's callbacks. Instead each render refreshes these references and the
 * flush reads the latest ones.
 */
const flushDeps: {
  getCartActionData:
    | ((formData: FormData) => Promise<CartActionData | null>)
    | null;
  setOptimisticLine:
    | ((lineId: string, quantity: number, seq: number) => void)
    | null;
  reconcileOptimisticLines:
    | ((flushedSeqs: Record<string, number>) => void)
    | null;
} = {
  getCartActionData: null,
  setOptimisticLine: null,
  reconcileOptimisticLines: null,
};

const scheduleLineQuantity = (lineId: string, quantity: number) => {
  const seq = ++seqCounter;
  flushDeps.setOptimisticLine?.(lineId, quantity, seq);
  pendingUpdates.set(lineId, {quantity, seq});
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void runFlush();
  }, DEBOUNCE_MS);
};

const runFlush = (): Promise<void> => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (!pendingUpdates.size) return Promise.resolve();

  const {getCartActionData, reconcileOptimisticLines} = flushDeps;
  if (!getCartActionData || !reconcileOptimisticLines) return Promise.resolve();

  // Snapshot and reset the batch so clicks made while the flush is in flight
  // accumulate into the next window.
  const batch = pendingUpdates;
  pendingUpdates = new Map();

  const flushedSeqs: Record<string, number> = {};
  const updates: {id: string; quantity: number}[] = [];
  const removeIds: string[] = [];
  batch.forEach(({quantity, seq}, lineId) => {
    flushedSeqs[lineId] = seq;
    // The Storefront API does not remove a line via a quantity-0 update, so a
    // zeroed line is routed to cartLinesRemove instead.
    if (quantity > 0) updates.push({id: lineId, quantity});
    else removeIds.push(lineId);
  });

  const ops: Promise<CartActionData | null>[] = [];
  if (updates.length) {
    const formData = new FormData();
    formData.append('action', CartForm.ACTIONS.LinesUpdate);
    formData.append('lines', JSON.stringify(updates));
    ops.push(getCartActionData(formData));
  }
  if (removeIds.length) {
    const formData = new FormData();
    formData.append('action', CartForm.ACTIONS.LinesRemove);
    formData.append('lineIds', JSON.stringify(removeIds));
    ops.push(getCartActionData(formData));
  }

  return Promise.all(ops).then(() => {
    // Drop only the overlay entries we just flushed and that haven't advanced
    // past the flushed seq (a newer click mid-flight survives reconciliation).
    reconcileOptimisticLines(flushedSeqs);
  });
};

export const useCart = (): CartWithActions => {
  const {isPreviewModeEnabled} = useRootLoaderData();
  const {publish, shop} = useAnalytics();

  const {
    state: {cart, status, error, optimisticLines},
    actions: {
      setCart,
      setError,
      setStatus,
      setOptimisticLine,
      reconcileOptimisticLines,
    },
  } = useCartContext();

  const getCartActionData = useCallback(
    (formData: FormData): Promise<CartActionData | null> => {
      const action = formData.get('action');

      const mutation = async (): Promise<CartActionData | null> => {
        let data = null as CartActionData | null;
        setError(null);
        setStatus(action === CartForm.ACTIONS.Create ? 'creating' : 'updating');
        try {
          const response = await fetch('/api/cart', {
            method: 'POST',
            body: formData,
          });
          data = await response.json();
          if (data?.userErrors?.length) {
            setError(data.userErrors);
          }
          if (data?.cart) {
            setCart(data.cart);
          }
          setStatus('idle');
          return data;
        } catch (err) {
          setError(err);
          setStatus('idle');
          return null;
        }
      };

      mutationQueue = mutationQueue.then(mutation, mutation);
      return mutationQueue;
    },
    [setCart, setError, setStatus],
  );

  // Refresh the flush dependencies every render so the module-level debounced
  // flush always uses the current context callbacks.
  flushDeps.getCartActionData = getCartActionData;
  flushDeps.setOptimisticLine = setOptimisticLine;
  flushDeps.reconcileOptimisticLines = reconcileOptimisticLines;

  const cartCreate: CartWithActions['cartCreate'] = useCallback(
    async (cartInput) => {
      const formData = new FormData();
      formData.append('action', CartForm.ACTIONS.Create);
      formData.append('cart', JSON.stringify(cartInput));
      return getCartActionData(formData);
    },
    [getCartActionData],
  );

  const linesAdd: CartWithActions['linesAdd'] = useCallback(
    async (lines) => {
      const formData = new FormData();
      formData.append('action', CartForm.ACTIONS.LinesAdd);
      formData.append('lines', JSON.stringify(lines));
      return getCartActionData(formData);
    },
    [cart, getCartActionData, publish, shop],
  );

  const linesUpdate: CartWithActions['linesUpdate'] = useCallback(
    async (lines) => {
      const formData = new FormData();
      formData.append('action', CartForm.ACTIONS.LinesUpdate);
      formData.append('lines', JSON.stringify(lines));
      return getCartActionData(formData);
    },
    [cart, getCartActionData, publish, shop],
  );

  const linesRemove: CartWithActions['linesRemove'] = useCallback(
    async (lineIds) => {
      const formData = new FormData();
      formData.append('action', CartForm.ACTIONS.LinesRemove);
      formData.append('lineIds', JSON.stringify(lineIds));
      return getCartActionData(formData);
    },
    [cart, getCartActionData, publish, shop],
  );

  const setLineQuantity: CartWithActions['setLineQuantity'] = useCallback(
    (lineId, quantity) => {
      scheduleLineQuantity(lineId, quantity);
    },
    [],
  );

  const flushPendingCartUpdates: CartWithActions['flushPendingCartUpdates'] =
    useCallback(() => runFlush(), []);

  const discountCodesUpdate: CartWithActions['discountCodesUpdate'] =
    useCallback(
      async (discountCodes) => {
        const formData = new FormData();
        formData.append('action', CartForm.ACTIONS.DiscountCodesUpdate);
        formData.append('discountCodes', JSON.stringify(discountCodes));
        return getCartActionData(formData);
      },
      [getCartActionData],
    );

  const cartAttributesUpdate: CartWithActions['cartAttributesUpdate'] =
    useCallback(
      async (attributes) => {
        const formData = new FormData();
        formData.append('action', CartForm.ACTIONS.AttributesUpdateInput);
        formData.append('attributes', JSON.stringify(attributes));
        return getCartActionData(formData);
      },
      [getCartActionData],
    );

  const buyerIdentityUpdate: CartWithActions['buyerIdentityUpdate'] =
    useCallback(
      async (
        buyerIdentity: CartBuyerIdentityInput,
      ): Promise<CartActionData | null> => {
        const formData = new FormData();
        formData.append('action', CartForm.ACTIONS.BuyerIdentityUpdate);
        formData.append('buyerIdentity', JSON.stringify(buyerIdentity));
        return getCartActionData(formData);
      },
      [getCartActionData],
    );

  const noteUpdate: CartWithActions['noteUpdate'] = useCallback(
    async (note) => {
      const formData = new FormData();
      formData.append('action', CartForm.ACTIONS.NoteUpdate);
      formData.append('note', note);
      return getCartActionData(formData);
    },
    [getCartActionData],
  );

  if (isPreviewModeEnabled) {
    // isPreviewModeEnabled will not change during the session (i.e. between
    // renders), so it's safe to call this hook conditionally.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const clientSideCart = useClientSideCart();
    return {
      ...clientSideCart,
      // Optimistic quantities aren't supported in the editor preview, so fall
      // back to the client-side cart's immediate mutations.
      setLineQuantity: (lineId: string, quantity: number) =>
        quantity > 0
          ? clientSideCart.linesUpdate([{id: lineId, quantity}])
          : clientSideCart.linesRemove([lineId]),
      flushPendingCartUpdates: () => Promise.resolve(),
      isSyncingCart: false,
    } as unknown as CartWithActions;
  }

  // Merge the optimistic overlay onto the authoritative server lines. Quantities
  // (and the derived total quantity) update instantly; line/cart money stays at
  // the last server value until the mutation reconciles, since discounts and
  // cart-script splits can't be predicted client-side.
  const baseLines = cart?.lines ? flattenConnection(cart.lines) : [];
  const lines = baseLines
    .map((line) => {
      const optimistic = optimisticLines[line.id];
      if (!optimistic || optimistic.quantity === line.quantity) return line;
      // Preserve the server quantity (`_serverQuantity`) so per-unit pricing
      // can keep dividing the stale-but-correct server cost by the matching
      // quantity — line money must not move with the optimistic quantity.
      return {
        ...line,
        quantity: optimistic.quantity,
        _serverQuantity: line.quantity,
      };
    })
    // A line optimistically set to 0 is being removed — hide it immediately.
    .filter((line) => (line.quantity ?? 0) > 0);

  const totalQuantity = lines.reduce(
    (sum, line) => sum + (line.quantity || 0),
    0,
  );

  return {
    ...cart,
    lines,
    totalQuantity,
    buyerIdentityUpdate,
    cartAttributesUpdate,
    cartCreate,
    discountCodesUpdate,
    error,
    flushPendingCartUpdates,
    isSyncingCart: Object.keys(optimisticLines).length > 0,
    linesAdd,
    linesRemove,
    linesUpdate,
    noteUpdate,
    setLineQuantity,
    status,
  } as CartWithActions;
};
