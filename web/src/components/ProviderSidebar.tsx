import { useEffect, useState } from "react";
import {
  ShoppingBag,
  ShoppingCart,
  CreditCard,
  Package,
  Database,
  Layers,
  Users,
  Phone,
  Repeat,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Bug,
  Menu,
  X,
} from "lucide-react";
import type { Provider } from "../engine/types";

const ICONS: Record<string, typeof ShoppingBag> = {
  "shopping-bag": ShoppingBag,
  "shopping-cart": ShoppingCart,
  "credit-card": CreditCard,
  package: Package,
  database: Database,
  layers: Layers,
  users: Users,
  phone: Phone,
  repeat: Repeat,
};

interface Props {
  providers: Provider[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function ProviderSidebar({
  providers,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapse,
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
        <img src="/doppel-logo.svg" alt="DoppelForge" className="brand-logo" />
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </header>
      {menuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}
      {/* `display: contents` on desktop so this wrapper is invisible to the
          flex layout. On mobile (in App.css media query) it becomes the
          absolutely-positioned dropdown drawer toggled by the hamburger. */}
      <div className="sidebar-drawer">
        <ul className="provider-list">
          {providers.map((p) => {
            const Icon = ICONS[p.manifest.icon] ?? Layers;
            const active = p.manifest.id === selectedId;
            return (
              <li key={p.manifest.id}>
                <button
                  className={`provider-item${active ? " active" : ""}`}
                  style={{ "--accent": p.manifest.color } as React.CSSProperties}
                  onClick={() => {
                    onSelect(p.manifest.id);
                    closeMenu();
                  }}
                  title={collapsed ? p.manifest.name : undefined}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="provider-name">{p.manifest.name}</span>
                  <span className="endpoint-count">{p.endpoints.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
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
