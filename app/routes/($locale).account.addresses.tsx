import {json, redirect} from '@shopify/remix-oxygen';
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaArgs,
} from '@shopify/remix-oxygen';
import {AnalyticsPageType, getSeoMeta} from '@shopify/hydrogen';

import {redirectLinkIfLoggedOut} from '~/lib/customer';
import {
  customerAddressesAction,
  customerAddressesLoader,
} from '~/lib/customer/servers/addresses.server';
import {getAccountSeo} from '~/lib/utils';
import {CustomerAccountLayout, Addresses} from '~/components';

export async function action({request, context}: ActionFunctionArgs) {
  const {data, status} = await customerAddressesAction({request, context});
  return json(data, {status});
}

export async function loader({context, params}: LoaderFunctionArgs) {
  const redirectLink = await redirectLinkIfLoggedOut({context, params});
  if (redirectLink) return redirect(redirectLink);
  const {data, status} = await customerAddressesLoader({context});
  const analytics = {pageType: AnalyticsPageType.customersAddresses};
  const seo = await getAccountSeo(context, 'Addresses');
  return json({...data, analytics, seo}, {status});
}

export const meta = ({matches}: MetaArgs<typeof loader>) => {
  return getSeoMeta(...matches.map((match) => (match.data as any).seo));
};

export default function AddressesRoute() {
  return (
    <CustomerAccountLayout>
      <Addresses />
    </CustomerAccountLayout>
  );
}

AddressesRoute.displayName = 'AddressesRoute';
