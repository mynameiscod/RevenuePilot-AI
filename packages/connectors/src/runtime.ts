// Server-only registry. The catalog remains safe to import into the web bundle.
import { providers } from "./index.ts";
import { validateConnection } from "./settings.ts";
import { ProviderError } from "./http.ts";
import {
  pullSpend,
  pullContacts,
  submitConversion,
  type ProviderContext,
  type Conversion,
} from "./adapters/marketing.ts";
import { analyzeText, sendMessage, startCall } from "./adapters/actions.ts";
import {
  createCheckout,
  verifyCheckout,
  type CheckoutRequest,
} from "./adapters/payments.ts";
export function adapterFor(context: ProviderContext) {
  const manifest = providers.find((p) => p.id === context.provider);
  if (!manifest) throw new ProviderError("UNSUPPORTED_PROVIDER");
  validateConnection(context.provider, context.settings, context.credentials);
  const requireCapability = (name: string) => {
    if (!manifest.capabilities.includes(name))
      throw new ProviderError("CAPABILITY_UNAVAILABLE");
  };
  return {
    manifest,
    pullSpend: (since: string, until: string, cursor?: string) => {
      requireCapability("ads.read");
      return pullSpend(context, since, until, cursor);
    },
    pullContacts: (cursor?: string) => {
      if (
        !manifest.capabilities.some((c) =>
          ["contacts.read", "leads.read"].includes(c),
        )
      )
        throw new ProviderError("CAPABILITY_UNAVAILABLE");
      return pullContacts(context, cursor);
    },
    submitConversion: (event: Conversion) => {
      requireCapability("conversions.submit");
      return submitConversion(context, event);
    },
    analyze: (text: string) => {
      requireCapability("ai.structured");
      return analyzeText(context, text);
    },
    send: (contact: { email: string; phone: string }) => {
      requireCapability("messages.send");
      return sendMessage(context, contact);
    },
    call: (contact: { name: string; phone: string }, commandId: string) => {
      requireCapability("calls.schedule");
      return startCall(context, contact, commandId);
    },
    createCheckout: (input: CheckoutRequest) => {
      requireCapability("checkout.create");
      return createCheckout(context.provider, context.credentials, input);
    },
    verifyCheckout: (externalId: string, paymentId?: string) => {
      requireCapability("payments.read");
      return verifyCheckout(
        context.provider,
        context.credentials,
        externalId,
        context.mode,
        paymentId,
      );
    },
  };
}
