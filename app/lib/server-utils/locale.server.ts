import cookieParser from 'cookie';
import type {AppLoadContext} from 'react-router';
import type {Localization} from '@shopify/hydrogen/storefront-api-types';

import {countries} from '~/data/countries';
import {DEFAULT_LOCALE} from '~/lib/constants';
import {LOCALIZATION_QUERY} from '~/data/graphql/storefront/shop';
import {pathWithoutLocalePrefix} from '~/lib/utils';

import type {I18nLocale} from '../types';

export function getLocaleFromRequest(request: Request): I18nLocale {
  const url = new URL(request.url);
  const firstPathPart =
    '/' +
    url.pathname.substring(1).split('/')[0].toLowerCase().replace('.data', '');

  return countries[firstPathPart]
    ? {
        ...countries[firstPathPart],
        pathPrefix: firstPathPart,
      }
    : {
        ...countries['default'],
        pathPrefix: '',
      };
}

const REDIRECTED_TO_LOCALE_COOKIE = 'redirected_to_locale';
const DEFAULT_DAY_EXPIRES = 7;

export async function redirectLinkToBuyerLocale({
  context,
  request,
}: {
  context: AppLoadContext;
  request: Request;
}): Promise<
  {to: string; options: {headers: Record<string, string>}} | undefined
> {
  const {storefront, oxygen} = context;

  const cookies = cookieParser.parse(request.headers.get('Cookie') || '');
  const redirectedToLocaleCookie = cookies[REDIRECTED_TO_LOCALE_COOKIE];

  // If cookie is already set, do not redirect again
  if (redirectedToLocaleCookie) return undefined;

  const {localization}: {localization: Localization} = await storefront.query(
    LOCALIZATION_QUERY,
    {
      variables: {
        country: storefront.i18n.country,
        language: storefront.i18n.language,
      },
      cache: storefront.CacheLong(),
    },
  );
  const buyerLocale = localization?.availableCountries?.find((country) => {
    return (
      country.isoCode.toLowerCase() === oxygen.buyer.country?.toLowerCase()
    );
  });

  // If buyer's locale is an available country, redirect to url with correct locale and set cookie
  if (buyerLocale) {
    const {pathname, search} = new URL(request.url);
    let newUrl = '';
    const pathnameWithoutLocale = pathname.replace(
      /^\/[a-zA-Z]{2}-[a-zA-Z]{2}/,
      '',
    );
    if (
      buyerLocale.isoCode.toLowerCase() === DEFAULT_LOCALE.country.toLowerCase()
    ) {
      newUrl = `${pathnameWithoutLocale}${search}`;
    } else {
      newUrl = `/${DEFAULT_LOCALE.language.toLowerCase()}-${buyerLocale.isoCode.toLowerCase()}${pathnameWithoutLocale}${search}`;
    }

    const daysInMs = DEFAULT_DAY_EXPIRES * 24 * 60 * 60 * 1000;
    const expiresAtInMs = Date.now() + daysInMs;
    const expiresAt = new Date(expiresAtInMs).toUTCString();

    return {
      to: newUrl,
      options: {
        headers: {
          'Set-Cookie': `${REDIRECTED_TO_LOCALE_COOKIE}=true; Path=/; Expires=${expiresAt}; SameSite=Lax;`,
        },
      },
    };
  }

  return undefined;
}

interface LocaleAlternate {
  language: string;
  url: string;
  default?: boolean;
}

/**
 * Build the list of hreflang alternates for the current page, one per market
 * Shopify actually serves (from `localization.availableCountries`), plus an
 * `x-default` pointing at the unprefixed default-locale version.
 *
 * These feed `SeoConfig.alternates`, which `getSeoMeta` renders as
 * `<link rel="alternate" hreflang="..." href="..." />` tags. They let search
 * engines group the per-market URLs (`/en-ca/...`, `/en-fr/...`, etc.) as one
 * page instead of indexing each as duplicate content, and serve the right
 * regional version to users.
 *
 * @see https://developers.google.com/search/docs/specialty/international/localized-versions
 */
export async function getLocaleAlternates({
  context,
  request,
}: {
  context: AppLoadContext;
  request: Request;
}): Promise<LocaleAlternate[]> {
  const {storefront} = context;

  let availableCountries: Localization['availableCountries'] = [];
  try {
    const {localization}: {localization: Localization} = await storefront.query(
      LOCALIZATION_QUERY,
      {
        variables: {
          country: storefront.i18n.country,
          language: storefront.i18n.language,
        },
        cache: storefront.CacheLong(),
      },
    );
    availableCountries = localization?.availableCountries || [];
  } catch {
    // Never let an hreflang lookup break page rendering.
    return [];
  }

  if (!availableCountries.length) return [];

  const {origin, pathname} = new URL(request.url);
  // Strip any existing locale prefix so we can re-prefix per market.
  const pathWithoutLocale = pathWithoutLocalePrefix(pathname);
  const language = DEFAULT_LOCALE.language.toLowerCase();
  const defaultCountry = DEFAULT_LOCALE.country.toLowerCase();

  const alternates: LocaleAlternate[] = availableCountries.map((country) => {
    const isoCode = country.isoCode.toLowerCase();
    // The default market is served without a locale prefix.
    const prefix = isoCode === defaultCountry ? '' : `/${language}-${isoCode}`;
    return {
      language: `${language}-${country.isoCode.toUpperCase()}`,
      url: `${origin}${prefix}${pathWithoutLocale}`,
    };
  });

  // x-default → the unprefixed default-locale version of this page.
  alternates.push({
    language: 'x',
    default: true,
    url: `${origin}${pathWithoutLocale}`,
  });

  return alternates;
}
