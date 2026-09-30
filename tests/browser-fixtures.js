import { test as base, expect } from "@playwright/test";

export async function isolateFonts(context) {
  // Functional tests must not depend on Google's font servers being reachable.
  // Keep all application requests real; only optional remote fonts are stubbed.
  await context.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
  await context.route("https://fonts.gstatic.com/**", route => route.abort());
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await isolateFonts(context);
    await use(context);
  },
});
export { expect };
