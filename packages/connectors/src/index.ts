export type Category =
  "advertising" | "crm" | "calling" | "payments" | "ai" | "messaging";
export interface ProviderManifest {
  id: string;
  name: string;
  category: Category;
  description: string;
  capabilities: string[];
  credentialFields: { key: string; label: string }[];
  status: "adapter_available";
  color: string;
  monogram: string;
}
export const providers: ProviderManifest[] = [
  {
    id: "meta",
    name: "Meta Ads",
    category: "advertising",
    description: "Campaign spend, lead forms and conversion outcomes.",
    capabilities: ["ads.read", "leads.read", "conversions.submit"],
    credentialFields: [{ key: "accessToken", label: "Access token" }],
    color: "#4267ed",
    monogram: "m",
  },
  {
    id: "google_ads",
    name: "Google Ads",
    category: "advertising",
    description: "Search and YouTube acquisition in one account.",
    capabilities: ["ads.read", "conversions.submit"],
    credentialFields: [
      { key: "clientId", label: "OAuth client ID" },
      { key: "clientSecret", label: "OAuth client secret" },
      { key: "refreshToken", label: "OAuth refresh token" },
      { key: "developerToken", label: "Developer token" },
    ],
    color: "#4285f4",
    monogram: "G",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    description: "Contacts, opportunities and sales activity.",
    capabilities: ["contacts.read"],
    credentialFields: [{ key: "accessToken", label: "Private app token" }],
    color: "#ec7956",
    monogram: "H",
  },
  {
    id: "generic_crm",
    name: "Custom CRM",
    category: "crm",
    description: "An explicit contract for your independent CRM adapter.",
    capabilities: ["contacts.read"],
    credentialFields: [
      { key: "webhookSecret", label: "Webhook signing secret" },
    ],
    color: "#6d63c7",
    monogram: "C",
  },
  {
    id: "outpero",
    name: "Outpero",
    category: "calling",
    description: "Call outcomes, transcripts and response activity.",
    capabilities: ["calls.schedule", "calls.webhook"],
    credentialFields: [
      { key: "leadSecret", label: "Lead intake secret" },
      { key: "webhookSecret", label: "Webhook signing secret" },
    ],
    color: "#9c65bd",
    monogram: "O",
  },
  {
    id: "razorpay",
    name: "Razorpay",
    category: "payments",
    description: "Captured payments, refunds and reconciliation.",
    capabilities: ["checkout.create", "payments.read", "refunds.read"],
    credentialFields: [
      { key: "keyId", label: "Key ID" },
      { key: "keySecret", label: "Key secret" },
      { key: "webhookSecret", label: "Webhook signing secret" },
    ],
    color: "#3867cb",
    monogram: "R",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    description: "Payment evidence across currencies and markets.",
    capabilities: ["checkout.create", "payments.read", "refunds.read"],
    credentialFields: [
      { key: "secretKey", label: "Restricted secret key" },
      { key: "webhookSecret", label: "Webhook signing secret" },
    ],
    color: "#7660df",
    monogram: "S",
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    description: "Structured analysis with evidence and usage budgets.",
    capabilities: ["ai.structured"],
    credentialFields: [{ key: "apiKey", label: "API key" }],
    color: "#319280",
    monogram: "O",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    description: "An interchangeable model provider for analysis.",
    capabilities: ["ai.structured"],
    credentialFields: [{ key: "apiKey", label: "API key" }],
    color: "#b98962",
    monogram: "A",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Cloud",
    category: "messaging",
    description: "Approved templates and message delivery evidence.",
    capabilities: ["messages.send", "messages.webhook"],
    credentialFields: [
      { key: "accessToken", label: "Access token" },
      { key: "appSecret", label: "App secret" },
      { key: "verifyToken", label: "Webhook verification token" },
    ],
    color: "#36a881",
    monogram: "W",
  },
  {
    id: "ses",
    name: "Amazon SES",
    category: "messaging",
    description: "Email delivery, bounces and suppression states.",
    capabilities: ["messages.send", "messages.webhook"],
    credentialFields: [
      { key: "accessKeyId", label: "Access key ID" },
      { key: "secretAccessKey", label: "Secret access key" },
    ],
    color: "#d19337",
    monogram: "S",
  },
].map((p) => ({
  ...p,
  category: p.category as Category,
  status: "adapter_available" as const,
}));

export interface ConnectorContext {
  tenantId: string;
  connectionId: string;
  traceId: string;
  deadlineAt: Date;
}
export interface ChangePage {
  items: {
    externalId: string;
    revision: string;
    occurredAt: string;
    type: string;
    data: Record<string, unknown>;
  }[];
  nextCursor?: string;
  complete: boolean;
}
export interface ConnectorAdapter {
  manifest: ProviderManifest;
  checkHealth(
    context: ConnectorContext,
  ): Promise<{ status: "healthy" | "degraded"; checkedAt: string }>;
  pull(context: ConnectorContext, cursor?: string): Promise<ChangePage>;
}
