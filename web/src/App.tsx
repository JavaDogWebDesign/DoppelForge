import { useCallback, useMemo, useState } from "react";
import { FileText, Files } from "lucide-react";
import { loadProviders } from "./providers/loader";
import {
  loadCustomProviders,
  type ParsedCustomProvider,
} from "./providers/customProviders";
import { ProviderSidebar } from "./components/ProviderSidebar";
import { Workspace } from "./components/Workspace";
import { BatchWorkspace } from "./components/BatchWorkspace";
import { MobileWarning } from "./components/MobileWarning";
import { CustomProviderModal } from "./components/CustomProviderModal";
import { useLocalStorageState, boolCodec, stringCodec } from "./hooks/useLocalStorageState";
import type { InputFormat } from "./engine/xml";
import "./App.css";

const SIDEBAR_STATE_KEY = "doppelforge.sidebar.collapsed";
const MODE_KEY = "doppelforge.mode";

type Mode = "single" | "batch";

const modeCodec = stringCodec<Mode>((v): v is Mode => v === "single" || v === "batch");

export default function App() {
  const builtInProviders = useMemo(() => loadProviders(), []);
  const builtInIds = useMemo(
    () => new Set(builtInProviders.map((p) => p.manifest.id)),
    [builtInProviders],
  );
  const [customProviders, setCustomProviders] = useState<ParsedCustomProvider[]>(
    () => loadCustomProviders(),
  );
  // Sort custom providers alongside built-ins by name so the sidebar stays
  // alphabetic. The "custom" pill in ProviderSidebar tells them apart.
  const providers = useMemo(() => {
    const merged = [
      ...builtInProviders,
      ...customProviders.map((c) => c.provider),
    ];
    return merged.sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }, [builtInProviders, customProviders]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // True while the most recent provider switch came from a user click in the
  // sidebar (not from automatic signature detection). The Workspace
  // auto-switch effect respects this and refuses to override the user's
  // choice until they paste new input.
  const [manualSelection, setManualSelection] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState(
    SIDEBAR_STATE_KEY,
    false,
    boolCodec,
  );
  const [mode, setMode] = useLocalStorageState<Mode>(MODE_KEY, "single", modeCodec);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  // When set, the modal opens directly into edit-mode for this provider id.
  // Cleared on close. Lets the sidebar's per-row edit button skip the "open
  // → scroll to list → click Edit" dance and jump straight to the editor.
  const [customModalEditId, setCustomModalEditId] = useState<string | null>(null);
  // Format auto-detected from whatever the user pasted into the active
  // workspace. Drives the "Supported formats" highlight in the sidebar so
  // formats with no matching provider (CSV, NDJSON, plain JSON/XML) still get
  // visible confirmation that the paste was recognized.
  const [detectedFormat, setDetectedFormat] = useState<InputFormat | null>(null);

  const customIds = useMemo(
    () => new Set(customProviders.map((c) => c.provider.manifest.id)),
    [customProviders],
  );

  // Sidebar click = user-driven selection, locks against auto-switch.
  const handleManualSelect = useCallback((id: string) => {
    setSelectedId(id);
    setManualSelection(true);
  }, []);
  // Sidebar pencil click on a custom provider → open the modal pre-loaded with
  // that provider's YAML in edit mode.
  const handleEditCustom = useCallback((id: string) => {
    setCustomModalEditId(id);
    setCustomModalOpen(true);
  }, []);
  const handleCloseCustomModal = useCallback(() => {
    setCustomModalOpen(false);
    setCustomModalEditId(null);
  }, []);
  // Workspace auto-switch (signature-detected provider) doesn't lock.
  const handleAutoSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);
  // Workspace clears the lock when the user pastes new content — at that
  // point intent is unclear, so let auto-detect take over again.
  const handleResetManualSelection = useCallback(() => {
    setManualSelection(false);
  }, []);

  const handleProviderSaved = useCallback(() => {
    setCustomProviders(loadCustomProviders());
  }, []);

  const handleProviderDeleted = useCallback(
    (deletedId: string) => {
      setCustomProviders(loadCustomProviders());
      if (selectedId === deletedId) setSelectedId(null);
    },
    [selectedId],
  );

  const selected = providers.find((p) => p.manifest.id === selectedId) ?? null;

  return (
    <div className="app">
      <MobileWarning />
      <ProviderSidebar
        providers={providers}
        customIds={customIds}
        selectedId={selectedId}
        onSelect={handleManualSelect}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onOpenCustomModal={() => setCustomModalOpen(true)}
        onEditCustom={handleEditCustom}
        detectedFormat={detectedFormat}
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
            onSelectProvider={handleAutoSelect}
            manualSelection={manualSelection}
            onResetManualSelection={handleResetManualSelection}
            onDetectedFormatChange={setDetectedFormat}
          />
        ) : (
          <BatchWorkspace
            provider={selected}
            allProviders={providers}
            onSelectProvider={setSelectedId}
          />
        )}
      </main>
      {customModalOpen && (
        <CustomProviderModal
          builtInIds={builtInIds}
          customProviders={customProviders}
          initialEditId={customModalEditId}
          onClose={handleCloseCustomModal}
          onSaved={handleProviderSaved}
          onDeleted={handleProviderDeleted}
        />
      )}
    </div>
  );
}
