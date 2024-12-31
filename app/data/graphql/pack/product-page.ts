import {SECTION_FRAGMENT} from './settings';

export const PRODUCT_PAGE_QUERY = `
  query ProductPage($handle: String!, $version: Version) {
    productPage: productPageByHandle(handle: $handle, version: $version) {
      id
      title
      handle
      status
      sections(first: 25) {
        nodes {
          ...SectionFragment
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      seo {
        title
        image
        keywords
        noFollow
        noIndex
      }
      template {
        id
        title
        type
        status
        publishedAt
        createdAt
        updatedAt
      }
      publishedAt
      createdAt
      updatedAt
    }
  }
  ${SECTION_FRAGMENT}
` as const;

export const CMS_PRODUCT_QUERY = `
  query CmsProductPage($handle: String!, $version: Version) {
    productPage: productPageByHandle(handle: $handle, version: $version) {
      seo {
        noIndex
      }
      sourceProduct {
        data {
          status
        }
      }
    }
  }
` as const;

export const CMS_PRODUCTS_QUERY = `
  query GetBackpackCmsProductPages($first: Int, $cursor: String) {
    productPages(first: $first, after: $cursor, version: PUBLISHED) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        seo {
          noIndex
        }
        sourceProduct {
          data {
            status
          }
        }
      }
    }
  }
` as const;
