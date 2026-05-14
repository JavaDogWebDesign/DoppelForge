import { useMemo, useState } from "react";
import { FileText, Files } from "lucide-react";
import { loadProviders } from "./providers/loader";
import { ProviderSidebar } from "./components/ProviderSidebar";
import { Workspace } from "./components/Workspace";
import { BatchWorkspace } from "./components/BatchWorkspace";
import { MobileWarning } from "./components/MobileWarning";
import { useLocalStorageState, boolCodec, stringCodec } from "./hooks/useLocalStorageState";
import "./App.css";

const SIDEBAR_STATE_KEY = "doppelforge.sidebar.collapsed";
const MODE_KEY = "doppelforge.mode";

type Mode = "single" | "batch";

const modeCodec = stringCodec<Mode>((v): v is Mode => v === "single" || v === "batch");

export default function App() {
  const providers = useMemo(() => loadProviders(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState(
    SIDEBAR_STATE_KEY,
    false,
    boolCodec,
  );
  const [mode, setMode] = useLocalStorageState<Mode>(MODE_KEY, "single", modeCodec);

  const selected = providers.find((p) => p.manifest.id === selectedId) ?? null;

  return (
    <div className="app">
      <MobileWarning />
      <ProviderSidebar
        providers={providers}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <main className="main">
        <div className="mode-tabs" role="tablist" aria-label="Workspace mode">
          <button
            role="tab"
            aria-selected={mode === "single"}
            className={`mode-tab${mode === "single" ? " active" : ""}`}
            onClick={() => setMode("single")}
          >
            <FileText size={12} />
            Single
          </button>
          <button
            role="tab"
            aria-selected={mode === "batch"}
            className={`mode-tab${mode === "batch" ? " active" : ""}`}
            onClick={() => setMode("batch")}
          >
            <Files size={12} />
            Batch
          </button>
        </div>
        {mode === "single" ? (
          <Workspace
            provider={selected}
            allProviders={providers}
            onSelectProvider={setSelectedId}
          />
        ) : (
          <BatchWorkspace
            provider={selected}
            allProviders={providers}
            onSelectProvider={setSelectedId}
          />
        )}
      </main>
    </div>
  );
}
