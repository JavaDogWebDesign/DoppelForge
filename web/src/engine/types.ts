export type SemanticType =
  | "email"
  | "firstName"
  | "lastName"
  | "fullName"
  | "phone"
  | "street"
  | "streetSecondary"
  | "city"
  | "state"
  | "stateOrProvince"
  | "postalCode"
  | "country"
  | "countryCode"
  | "company"
  | "id"
  | "uuid"
  | "ipv4"
  | "isoDate"
  | "birthDate"
  | "unixTimestamp"
  | "url"
  | "sku"
  | "productName"
  | "shortText"
  | "longText"
  | "currency"
  | "priceAmount"
  | "cvvCode"
  | "cvvMessage"
  | "avsCode"
  | "avsMessage"
  | "boolean"
  | "custom"
  | "preserve"
  | "auto"
  | "null"
  | "redact"
  | "nestedJson";

export interface FieldRule {
  type: SemanticType;
  anchor?: boolean;
}

export interface EndpointSignature {
  required_paths: string[];
  optional_paths?: string[];
}

export interface EndpointMeta {
  method: string;
  path: string;
  description?: string;
  doc_url?: string;
  kind?: "response" | "webhook";
}

export interface EndpointSpec {
  id: string;
  providerId: string;
  endpoint: EndpointMeta;
  signature: EndpointSignature;
  fields: Record<string, FieldRule>;
}

export interface ProviderManifest {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
  docs: string;
}

export interface Provider {
  manifest: ProviderManifest;
  endpoints: EndpointSpec[];
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
