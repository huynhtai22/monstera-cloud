

import { createPaddleCheckoutUrl } from '../src/lib/paddle';

async function test() {
  try {
    const url = await createPaddleCheckoutUrl(
      'professional',
      'monthly',
      'test-workspace-123',
      'test-user-123',
    );
    console.log("Paddle generated checkout URL:");
    console.log(url);
  } catch (error: any) {
    console.error("Error generating Paddle Checkout URL:");
    console.error(error.message);
  }
}

test();
