import type { EndpointSpec } from "../engine/types";

interface Props {
  endpoint: EndpointSpec | null;
  endpoints: EndpointSpec[];
  detectedFrom: "explicit" | "url" | "signature" | "none";
  onChange: (id: string | null) => void;
}

export function EndpointBadge({ endpoint, endpoints, detectedFrom, onChange }: Props) {
  const label = endpoint
    ? `${endpoint.endpoint.method} ${endpoint.endpoint.path}`
    : "Generic mode";

  const tag =
    detectedFrom === "explicit"
      ? "manual"
      : detectedFrom === "url"
        ? "URL match"
        : detectedFrom === "signature"
          ? "auto-detected"
          : "fallback";

  return (
    <div className="endpoint-badge">
      <select
        aria-label="API endpoint"
        value={endpoint?.id ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">- Generic mode -</option>
        {endpoints.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.endpoint.method} {ep.endpoint.path}
          </option>
        ))}
      </select>
      <span className={`badge-tag tag-${detectedFrom}`}>{tag}</span>
      {endpoint?.endpoint.kind === "webhook" && (
        <span className="badge-tag tag-webhook">webhook</span>
      )}
      <span className="badge-label" title={endpoint?.endpoint.description}>
        {label}
      </span>
    </div>
  );
}
