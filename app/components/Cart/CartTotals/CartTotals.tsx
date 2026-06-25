import {memo, useCallback, useMemo} from 'react';
import {useMoney} from '@shopify/hydrogen-react';
import clsx from 'clsx';
import type {CartCodeDiscountAllocation} from '@shopify/hydrogen/storefront-api-types';

import {prefixNonUsdDollar} from '~/hooks/product/useVariantPrices';
import {useCart, useCustomer, useLocale} from '~/hooks';

import type {CartTotalsProps} from '../Cart.types';

import {CartTotalsDiscountItem} from './CartTotalsDiscountItem';

export const CartTotals = memo(({settings}: CartTotalsProps) => {
  const {currency} = useLocale();
  const customer = useCustomer();
  const {
    checkoutUrl = '',
    cost,
    discountAllocations = [],
    flushPendingCartUpdates,
    isSyncingCart,
    totalQuantity = 0,
  } = useCart();

  const authenticatedCheckoutUrl = useMemo(() => {
    if (!checkoutUrl) return '';
    const url = new URL(checkoutUrl);
    if (customer) {
      url.searchParams.set('logged_in', 'true');
    }
    return url.toString();
  }, [checkoutUrl, !!customer]);

  // Flush any pending optimistic quantity changes to the server before leaving
  // for checkout, so the buyer can't check out with a stale quantity.
  const handleCheckout = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!authenticatedCheckoutUrl) return;
      await flushPendingCartUpdates();
      window.location.assign(authenticatedCheckoutUrl);
    },
    [authenticatedCheckoutUrl, flushPendingCartUpdates],
  );

  const parsedDiscountAllocations = useMemo(() => {
    const codes: string[] = [];
    return discountAllocations.reduce(
      (acc: CartCodeDiscountAllocation[], allocation: any) => {
        if (!allocation.code) return [...acc, allocation];
        if (!codes.includes(allocation.code)) {
          codes.push(allocation.code);
          return [...acc, allocation];
        }
        const codeIndex = acc.findIndex(
          (a: CartCodeDiscountAllocation) => a.code === allocation.code,
        );
        const previous = acc[codeIndex];
        const current = {
          ...previous,
          discountedAmount: {
            amount: (
              Number(previous.discountedAmount.amount) +
              Number(allocation.discountedAmount.amount)
            ).toFixed(2),
            currencyCode: previous.discountedAmount.currencyCode,
          },
        };
        acc.splice(codeIndex, 1, current);
        return acc;
      },
      [],
    );
  }, [discountAllocations]);

  const discountAmount = useMemo(() => {
    return discountAllocations.reduce((acc: number, discount) => {
      if (discount?.discountedAmount?.amount) {
        return acc + Number(discount.discountedAmount.amount);
      }
      return acc;
    }, 0);
  }, [discountAllocations]);

  const formattedSubtotal = useMoney({
    amount: cost?.subtotalAmount?.amount || '',
    currencyCode: cost?.subtotalAmount?.currencyCode || currency,
  });

  // total = subtotal - discountAmount (discount code applied to cart level)
  const formattedTotal = useMoney({
    amount: cost?.subtotalAmount?.amount
      ? (Number(cost.subtotalAmount.amount) - discountAmount).toFixed(2)
      : '',
    currencyCode: cost?.subtotalAmount?.currencyCode || currency,
  });

  const subtotalAmount = prefixNonUsdDollar(formattedSubtotal);
  const totalAmount = prefixNonUsdDollar(formattedTotal);
  const {checkoutText = 'Checkout', subtext = ''} = {
    ...settings?.totals,
  };
  const isDiscounted = discountAmount > 0;

  return (
    <div
      className={clsx(
        'flex-col gap-4 border-t border-t-border p-4',
        totalQuantity ? 'flex' : 'hidden',
      )}
    >
      <div
        className={clsx(
          'flex flex-col gap-1 transition-opacity',
          // Money is never optimistic — keep the last server-computed values
          // visible but hint that they're recalculating while a line change syncs.
          isSyncingCart && 'opacity-50',
        )}
      >
        {isDiscounted && (
          <>
            {subtotalAmount !== totalAmount && (
              <div className="flex justify-between">
                <p className="font-bold">Subtotal</p>
                <p>{subtotalAmount}</p>
              </div>
            )}

            {parsedDiscountAllocations?.length > 0 &&
              parsedDiscountAllocations.map((discount, index) => {
                return (
                  <CartTotalsDiscountItem discount={discount} key={index} />
                );
              })}
          </>
        )}

        <div className="flex justify-between">
          <p className="font-bold">Total</p>
          <p>{totalAmount}</p>
        </div>

        {subtext && <p className="text-xs">{subtext}</p>}
      </div>

      <button
        className="btn-primary w-full"
        onClick={handleCheckout}
        type="button"
      >
        {checkoutText}
      </button>
    </div>
  );
});

CartTotals.displayName = 'CartTotals';
