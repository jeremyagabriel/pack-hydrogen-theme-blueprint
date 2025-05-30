import snake_case from 'snakecase-keys';
import CryptoJS from 'crypto-js/core';
import aes from 'crypto-js/aes';

import type {MultipassCustomer} from './multipass.types';

/*
  Shopify multipassify implementation for node and v8/worker runtime
  based on crypto-js. This library is used to generate and parse multipass tokens.
  ------------------------------------------------------------
  @see: https://shopify.dev/api/multipass — Shopify multipass
  @see: https://github.com/beaucoo/multipassify — Previous art for Node-only runtime
*/
export class Multipassify {
  private readonly BLOCK_SIZE: number;
  private encryptionKey: CryptoJS.lib.WordArray;
  private signingKey: CryptoJS.lib.WordArray;

  public constructor(secret: string) {
    if (!(typeof secret == 'string' && secret.length > 0)) {
      throw new Error('Invalid Secret');
    }
    this.BLOCK_SIZE = 16;

    // Hash the secret
    const digest = CryptoJS.SHA256(secret);

    // create the encryption and signing keys
    this.encryptionKey = CryptoJS.lib.WordArray.create(
      digest.words.slice(0, this.BLOCK_SIZE / 4),
    );
    this.signingKey = CryptoJS.lib.WordArray.create(
      digest.words.slice(this.BLOCK_SIZE / 4, this.BLOCK_SIZE / 2),
    );

    return this;
  }

  // Generates an auth `token` and `url` for a customer based
  // on the `return_to` url property found in the customer object
  public generate(
    customer: MultipassCustomer,
    shopifyDomain: string,
    request: Request,
  ) {
    if (!shopifyDomain) {
      throw new Error('domain is required');
    }
    if (!customer?.email) {
      throw new Error('customer email is required');
    }

    // Generate a token
    const token = this.generateToken(snake_case(customer));

    // Get the origin of the request
    const toOrigin = new URL(request.url).origin;

    const redirectToShopify = customer.return_to
      ? customer.return_to.includes('cart/c') ||
        customer.return_to.includes('checkout') ||
        customer.return_to.includes('account')
      : false;

    // if the target url is the checkout or account, we use the shopify domain liquid auth
    const toUrl = redirectToShopify
      ? `https://${shopifyDomain}/account/login/multipass/${token}` // uses liquid multipass auth
      : `${toOrigin}/account/login/multipass/${token}`; // uses local multipass verification. @see: api route

    return {url: toUrl, token};
  }

  // Generates a token
  public generateToken(customer: MultipassCustomer): string {
    // Store the current time in ISO8601 format.
    // The token will only be valid for a small time-frame around this timestamp.
    customer.created_at = new Date().toISOString();

    const encrypted = this.encrypt(JSON.stringify(customer));
    const signature = this.sign(encrypted);

    // @ts-ignore - concat is a method on WordArray
    const token = encrypted.concat(signature);
    let token64 = token.toString(CryptoJS.enc.Base64);

    token64 = token64
      .replace(/\+/g, '-') // Replace + with -
      .replace(/\//g, '_'); // Replace / with _

    return token64;
  }

  // encrypt the customer data
  private encrypt(customerText: string) {
    // Use a random IV
    const iv = CryptoJS.lib.WordArray.random(this.BLOCK_SIZE);

    const cipher = aes.encrypt(customerText, this.encryptionKey, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    // Append iv as first block of the encryption
    // @ts-ignore - concat is a method on WordArray
    return iv.concat(cipher.ciphertext);
  }

  // signs the encrypted customer data
  private sign(encrypted: CryptoJS.lib.WordArray) {
    return CryptoJS.HmacSHA256(encrypted, this.signingKey);
  }

  // Decrypts the customer data from a multipass token
  public parseToken(token: string): MultipassCustomer {
    // reverse char replaces
    const token64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const tokenBytes = CryptoJS.enc.Base64.parse(token64);

    const encryptLength = tokenBytes.words.length - 8; // all minus 8 words of the signature
    const _encrypted = CryptoJS.lib.WordArray.create(
      tokenBytes.words.slice(0, encryptLength),
    );

    const iv = CryptoJS.lib.WordArray.create(
      _encrypted.words.slice(0, this.BLOCK_SIZE / 4),
    );

    const encrypted = CryptoJS.lib.WordArray.create(
      _encrypted.words.slice(iv.words.length, _encrypted.words.length),
    );

    const encryptedCustomer = CryptoJS.enc.Base64.stringify(encrypted);

    const decryptedCustomer = aes.decrypt(
      encryptedCustomer,
      this.encryptionKey,
      {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      },
    );

    const customerText = decryptedCustomer.toString(CryptoJS.enc.Utf8);
    const customer = JSON.parse(customerText) as MultipassCustomer;

    // Check if the token is still valid
    const now = new Date().toISOString();
    if (customer.created_at > now) {
      throw new Error('Token expired');
    }

    return customer;
  }
}
