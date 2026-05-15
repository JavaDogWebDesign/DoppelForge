import { useEffect, useState } from "react";
import {
  // Sidebar chrome
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Bug,
  Menu,
  X,
  Plus,
  Pencil,
  // Format pills
  Braces,
  Code,
  Table,
  AlignJustify,
  AtSign,
  // Provider icons (referenced by manifest.icon)
  ShoppingBag,
  ShoppingCart,
  Store,
  Package,
  Box,
  CreditCard,
  Wallet,
  DollarSign,
  Banknote,
  Users,
  User,
  Contact,
  Phone,
  Mail,
  Send,
  MessageCircle,
  MessageSquare,
  Repeat,
  RefreshCw,
  Calendar,
  Shield,
  Key,
  Lock,
  LifeBuoy,
  Headphones,
  HelpCircle,
  Megaphone,
  Target,
  Truck,
  Cloud,
  Server,
  Database,
  Layers,
  Building2,
  Briefcase,
  Settings,
  Square,
  Zap,
} from "lucide-react";
import type { Provider } from "../engine/types";
import type { InputFormat } from "../engine/xml";

// Provider manifests reference icons by string name. Add new icons here as
// providers need them; unmapped names fall back to `Layers`. The set is
// curated rather than pulling every Lucide icon - keeps the bundle small
// and gives custom-provider authors a discoverable list.
//
// Browse the full Lucide catalog at https://lucide.dev/icons - any icon
// added there can be wired up by adding an import above + an entry here.
const ICONS: Record<string, typeof ShoppingBag> = {
  // E-commerce
  "shopping-bag": ShoppingBag,
  "shopping-cart": ShoppingCart,
  store: Store,
  package: Package,
  box: Box,
  // Payments
  "credit-card": CreditCard,
  wallet: Wallet,
  "dollar-sign": DollarSign,
  banknote: Banknote,
  square: Square,
  // CRM / people
  users: Users,
  user: User,
  contact: Contact,
  // Communications
  phone: Phone,
  mail: Mail,
  send: Send,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  // Subscription / recurring
  repeat: Repeat,
  "refresh-cw": RefreshCw,
  calendar: Calendar,
  // Auth
  "shield-check": ShieldCheck,
  shield: Shield,
  key: Key,
  lock: Lock,
  // Support
  "life-buoy": LifeBuoy,
  headphones: Headphones,
  "help-circle": HelpCircle,
  // Marketing
  megaphone: Megaphone,
  target: Target,
  // Shipping
  truck: Truck,
  // Cloud / infra
  cloud: Cloud,
  server: Server,
  database: Database,
  // Generic
  layers: Layers,
  "building-2": Building2,
  briefcase: Briefcase,
  settings: Settings,
  zap: Zap,
};

// Supported input formats surfaced in the sidebar so users discover that
// non-provider payloads (CSV, NDJSON, form-encoded) are first-class. The
// active row highlights whichever format the InputEditor auto-detected.
const FORMATS: { id: InputFormat; label: string; icon: typeof Braces; hint: string }[] = [
  { id: "json", label: "JSON", icon: Braces, hint: "Standard JSON object or array" },
  { id: "xml", label: "XML", icon: Code, hint: "XML document" },
  { id: "ndjson", label: "NDJSON", icon: AlignJustify, hint: "Newline-delimited JSON" },
  { id: "csv", label: "CSV", icon: Table, hint: "Comma / tab / semicolon-separated values" },
  { id: "form", label: "Form", icon: AtSign, hint: "URL-encoded form body" },
];

interface Props {
  providers: Provider[];
  /** Subset of provider ids that came from the user's localStorage uploads. */
  customIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenCustomModal: () => void;
  /** Per-row "edit YAML" button on each custom provider - opens the modal
   *  directly into edit mode for that provider id. */
  onEditCustom: (id: string) => void;
  /** Format auto-detected from the user's current input. Drives the
   *  "Supported formats" highlight; null means no input or unrecognized. */
  detectedFormat?: InputFormat | null;
}

export function ProviderSidebar({
  providers,
  customIds,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapse,
  onOpenCustomModal,
  onEditCustom,
  detectedFormat = null,
}: Props) {
  // Mobile-only state. On desktop the drawer container is `display: contents`
  // so this flag has no effect and the original sidebar layout is unchanged.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Lock body scroll while the full-screen menu is open. Without this,
  // scrolling past the bottom of the drawer chains through to the workspace
  // behind it (the page keeps scrolling underneath the menu).
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <nav
      className={`sidebar${collapsed ? " collapsed" : ""}${menuOpen ? " menu-open" : ""}`}
    >
      <header className="sidebar-header">
        <button
          className="sidebar-hamburger"
          onClick={() => setMenuOpen((v) => !v)}
          title={menuOpen ? "Close menu" : "Open menu"}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        {/* Intrinsic dimensions (matches the SVG's 392x86 viewBox) so the
            browser can reserve space before load; CSS controls display size. */}
        <img
          src="/doppel-logo.svg"
          alt="DoppelForge"
          className="brand-logo"
          width={392}
          height={86}
        />
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </header>
      {/* `display: contents` on desktop so this wrapper is invisible to the
          flex layout. On mobile (in App.css media query) it becomes the
          full-screen menu toggled by the hamburger - closed via the X
          button in the header or the Esc key. */}
      <div className="sidebar-drawer">
        <ul className="provider-list">
          {providers.map((p) => {
            const Icon = ICONS[p.manifest.icon] ?? Layers;
            const active = p.manifest.id === selectedId;
            const isCustom = customIds.has(p.manifest.id);
            return (
              <li
                key={p.manifest.id}
                className={`provider-row${isCustom ? " is-custom" : ""}`}
              >
                <button
                  className={`provider-item${active ? " active" : ""}`}
                  style={{ "--accent": p.manifest.color } as React.CSSProperties}
                  onClick={() => {
                    onSelect(p.manifest.id);
                    closeMenu();
                  }}
                  // Always set the title so the full name is reachable even
                  // when truncated by ellipsis in the expanded sidebar.
                  title={p.manifest.name}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="provider-name">{p.manifest.name}</span>
                  {isCustom && (
                    <span
                      className="custom-pill"
                      title="Custom provider (your YAML, local-only)"
                      aria-label="Custom provider"
                    />
                  )}
                  <span className="endpoint-count">{p.endpoints.length}</span>
                </button>
                {isCustom && (
                  <button
                    className="provider-edit-btn"
                    onClick={() => {
                      onEditCustom(p.manifest.id);
                      closeMenu();
                    }}
                    title={`Edit YAML for ${p.manifest.name}`}
                    aria-label={`Edit YAML for ${p.manifest.name}`}
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
          <li className="provider-row">
            <button
              className="provider-item provider-item-add"
              onClick={() => {
                onOpenCustomModal();
                closeMenu();
              }}
              title="Add a custom provider (YAML stored locally in your browser)"
            >
              <Plus size={18} aria-hidden="true" />
              <span className="provider-name">Add custom</span>
            </button>
          </li>
        </ul>
        <section
          className="sidebar-formats"
          aria-label="Supported input formats"
        >
          <h2 className="sidebar-formats-title">Supported formats</h2>
          <ul className="sidebar-formats-list">
            {FORMATS.map((f) => {
              const Icon = f.icon;
              const active = detectedFormat === f.id;
              return (
                <li key={f.id}>
                  <span
                    className={`format-item${active ? " active" : ""}`}
                    title={
                      active
                        ? `${f.label} - detected in current input`
                        : f.hint
                    }
                    aria-current={active ? "true" : undefined}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="format-item-label">{f.label}</span>
                    {active && (
                      <span className="format-item-dot" aria-hidden="true" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <footer className="sidebar-footer">
          <a
            href="/about"
            className="sidebar-footer-link"
            title="About & Privacy"
            onClick={closeMenu}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>About & Privacy</span>
          </a>
          <a
            href="https://github.com/javadogwebdesign/doppelforge"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-footer-link"
            title="GitHub repo"
            onClick={closeMenu}
          >
            <GitHubIcon />
            <span>GitHub repo</span>
          </a>
          <a
            href="https://github.com/javadogwebdesign/doppelforge/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-footer-link"
            title="Report an issue"
            onClick={closeMenu}
          >
            <Bug size={16} aria-hidden="true" />
            <span>Report an issue</span>
          </a>
        </footer>
      </div>
    </nav>
  );
}

// Lucide pulled the GitHub mark over trademark concerns; inline the official
// octocat SVG (permitted for linking to GitHub).
function GitHubIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.97.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.91-.39.99 0 1.99.13 2.91.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.39-5.27 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56C20.22 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
