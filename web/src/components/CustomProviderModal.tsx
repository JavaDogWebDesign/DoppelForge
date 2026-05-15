import { useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Upload, Plus, Download, Info, Pencil } from "lucide-react";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  addCustomProvider,
  removeCustomProvider,
  type CustomProviderSource,
  type ParsedCustomProvider,
} from "../providers/customProviders";
import { YamlEditor } from "./YamlEditor";

interface Props {
  builtInIds: Set<string>;
  customProviders: ParsedCustomProvider[];
  /** If set, the modal opens directly into edit mode for this provider id.
   *  Used by the sidebar's per-row pencil button. */
  initialEditId?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (id: string) => void;
}

const SAMPLE_MANIFEST = `id: my-internal-api
name: My Internal API
category: internal
icon: database
color: "#6366F1"
docs: https://wiki.example.com/api
`;

const SAMPLE_ENDPOINT_SLUG = "users-retrieve";
const SAMPLE_ENDPOINT = `endpoint:
  method: GET
  path: /api/v1/users/{id}
  description: Retrieve a user

signature:
  required_paths:
    - id
    - email
    - created_at

fields:
  "id":         { type: id, anchor: true }
  "email":      { type: email, anchor: true }
  "first_name": { type: firstName }
  "last_name":  { type: lastName }
  "phone":      { type: phone }
  "created_at": { type: isoDate }
  "*":          { type: auto }
`;

export function CustomProviderModal({
  builtInIds,
  customProviders,
  initialEditId,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const [manifestYaml, setManifestYaml] = useState("");
  const [endpoints, setEndpoints] = useState<Array<{ slug: string; yaml: string }>>([
    { slug: "", yaml: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Tracks whether the editor is creating a new provider or modifying an
  // existing one. Drives the section header, the primary button label, and
  // the "back to new" affordance.
  const [editingId, setEditingId] = useState<string | null>(null);
  // When set, renders a confirmation dialog over the main modal. Replaces
  // the native window.confirm() which doesn't match the dark theme and
  // gives no way to style the destructive button.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);

  const editingProvider = useMemo(
    () =>
      editingId
        ? customProviders.find((p) => p.provider.manifest.id === editingId) ?? null
        : null,
    [editingId, customProviders],
  );

  // Open directly into edit mode when the caller (sidebar pencil button)
  // passed an initialEditId. Runs once on mount; subsequent prop changes do
  // not re-trigger so a user editing inside the modal isn't bounced.
  useEffect(() => {
    if (!initialEditId) return;
    const target = customProviders.find(
      (p) => p.provider.manifest.id === initialEditId,
    );
    if (target) loadExisting(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes the active overlay: confirm dialog first (so the user can
  // bail on a delete without also losing their unsaved edits in the main
  // modal), main modal second.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingDelete) {
        setPendingDelete(null);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pendingDelete]);

  // When the confirm dialog opens, focus the Cancel button so a stray Enter
  // press doesn't accidentally trigger the destructive action.
  useEffect(() => {
    if (pendingDelete) confirmCancelRef.current?.focus();
  }, [pendingDelete]);

  const hasContent = useMemo(
    () =>
      manifestYaml.trim().length > 0 ||
      endpoints.some((e) => e.slug.trim() || e.yaml.trim()),
    [manifestYaml, endpoints],
  );

  function loadSample() {
    setManifestYaml(SAMPLE_MANIFEST);
    setEndpoints([{ slug: SAMPLE_ENDPOINT_SLUG, yaml: SAMPLE_ENDPOINT }]);
    setError(null);
    setSuccess(null);
    setEditingId(null);
  }

  function clearForm() {
    setManifestYaml("");
    setEndpoints([{ slug: "", yaml: "" }]);
    setError(null);
    setSuccess(null);
    setEditingId(null);
  }

  // Switch back to "create a new provider" mode without losing any work
  // the user has already typed. Use after a Save, or via the explicit
  // "Add new instead" button in edit mode.
  function startNew() {
    setManifestYaml("");
    setEndpoints([{ slug: "", yaml: "" }]);
    setEditingId(null);
    setError(null);
    setSuccess(null);
  }

  function addEndpointRow() {
    setEndpoints((prev) => [...prev, { slug: "", yaml: "" }]);
  }

  function removeEndpointRow(index: number) {
    setEndpoints((prev) =>
      prev.length === 1 ? [{ slug: "", yaml: "" }] : prev.filter((_, i) => i !== index),
    );
  }

  function updateEndpoint(index: number, patch: Partial<{ slug: string; yaml: string }>) {
    setEndpoints((prev) =>
      prev.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    );
  }

  function loadExisting(p: ParsedCustomProvider) {
    setManifestYaml(p.source.manifestYaml);
    const rows = Object.entries(p.source.endpointYamls).map(([slug, yaml]) => ({
      slug,
      yaml,
    }));
    setEndpoints(rows.length === 0 ? [{ slug: "", yaml: "" }] : rows);
    setError(null);
    setSuccess(null);
    setEditingId(p.provider.manifest.id);
    // Scroll the editor into view so the user sees their click took effect.
    // The "Existing providers" list above can be tall enough that the editor
    // is offscreen otherwise.
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleSave() {
    setError(null);
    setSuccess(null);
    const endpointYamls: Record<string, string> = {};
    for (const row of endpoints) {
      const slug = row.slug.trim();
      const yaml = row.yaml.trim();
      if (!slug && !yaml) continue;
      if (!slug || !yaml) {
        setError("Every endpoint row needs both a slug and YAML content");
        return;
      }
      if (endpointYamls[slug] !== undefined) {
        setError(`Duplicate endpoint slug '${slug}'`);
        return;
      }
      endpointYamls[slug] = yaml;
    }
    if (Object.keys(endpointYamls).length === 0) {
      setError("Add at least one endpoint");
      return;
    }
    const source: CustomProviderSource = {
      manifestYaml: manifestYaml.trim(),
      endpointYamls,
    };
    const result = addCustomProvider(source, builtInIds);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Auto-close on successful save. The user's intent on clicking Save is
    // "I'm done with this edit" — staying open afterwards left Cancel as the
    // only exit, which read as "discard" even though the work was already
    // persisted. The sidebar re-renders via onSaved() and the saved provider
    // is visible there (with its dot indicator) as visual confirmation.
    onSaved();
    onClose();
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setSuccess(null);

    // Defense-in-depth caps against decompression bombs and oversized loose
    // YAMLs. Per-entry cap matches safeLoad()'s 200KB ceiling; total cap
    // leaves headroom for the ~1MB localStorage budget.
    const MAX_ZIP_BYTES = 5 * 1024 * 1024;
    const MAX_ENTRY_BYTES = 256 * 1024;
    const MAX_TOTAL_UNZIP_BYTES = 2 * 1024 * 1024;

    // Flatten: { name, text } for every yaml entry, whether the user
    // multi-selected loose .yaml files or dropped a .zip.
    type Entry = { name: string; text: string };
    const entries: Entry[] = [];

    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".zip")) {
          if (file.size > MAX_ZIP_BYTES) {
            setError(
              `Zip '${file.name}' is ${file.size} bytes — refusing to decompress (cap ${MAX_ZIP_BYTES})`,
            );
            return;
          }
          const buf = new Uint8Array(await file.arrayBuffer());
          let totalSeen = 0;
          let rejectReason: string | null = null;
          // fflate's filter runs against central-directory metadata, so we
          // can skip oversize entries before they're decompressed into memory.
          const unzipped = unzipSync(buf, {
            filter: (info) => {
              if (info.originalSize > MAX_ENTRY_BYTES) {
                rejectReason = `entry '${info.name}' is ${info.originalSize} bytes (per-file cap ${MAX_ENTRY_BYTES})`;
                return false;
              }
              if (totalSeen + info.originalSize > MAX_TOTAL_UNZIP_BYTES) {
                rejectReason = `total uncompressed size exceeds ${MAX_TOTAL_UNZIP_BYTES} bytes`;
                return false;
              }
              const nameLower = info.name.toLowerCase();
              if (!nameLower.endsWith(".yaml") && !nameLower.endsWith(".yml")) {
                return false;
              }
              totalSeen += info.originalSize;
              return true;
            },
          });
          if (rejectReason) {
            setError(`Zip '${file.name}': ${rejectReason}`);
            return;
          }
          for (const [path, bytes] of Object.entries(unzipped)) {
            // Belt-and-braces: a malicious zip could lie about originalSize.
            // Reject if actual decompressed bytes exceed the per-entry cap.
            if (bytes.byteLength > MAX_ENTRY_BYTES) {
              setError(
                `Zip '${file.name}': entry '${path}' decompressed to ${bytes.byteLength} bytes (cap ${MAX_ENTRY_BYTES})`,
              );
              return;
            }
            entries.push({ name: path, text: strFromU8(bytes) });
          }
        } else if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
          if (file.size > MAX_ENTRY_BYTES) {
            setError(
              `'${file.name}' is ${file.size} bytes (cap ${MAX_ENTRY_BYTES})`,
            );
            return;
          }
          entries.push({ name: file.name, text: await file.text() });
        }
      }
    } catch (err) {
      setError(
        `Failed to read upload: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // Resolve: the file whose basename is `manifest.yaml`/`.yml` is the
    // manifest. Everything else is an endpoint with slug = basename minus
    // extension. Strip any leading directory (zip files include them).
    let manifestText: string | null = null;
    const ep: Array<{ slug: string; yaml: string }> = [];
    for (const e of entries) {
      const base = e.name.split("/").pop()!.toLowerCase();
      if (base === "manifest.yaml" || base === "manifest.yml") {
        manifestText = e.text;
      } else {
        const slug = base.replace(/\.ya?ml$/, "");
        ep.push({ slug, yaml: e.text });
      }
    }

    if (manifestText === null && ep.length === 0) {
      setError("No .yaml files found in upload");
      return;
    }
    if (manifestText !== null) setManifestYaml(manifestText);
    if (ep.length > 0) setEndpoints(ep);
  }

  function exportAsZip(p: ParsedCustomProvider) {
    // Build the canonical directory layout the public providers/ tree uses.
    // Then a contributor can drop the unzipped folder straight into a PR.
    const folder = p.provider.manifest.id;
    const files: Record<string, Uint8Array> = {
      [`${folder}/manifest.yaml`]: strToU8(p.source.manifestYaml),
    };
    for (const [slug, yaml] of Object.entries(p.source.endpointYamls)) {
      files[`${folder}/endpoints/${slug}.yaml`] = strToU8(yaml);
    }
    const zipped = zipSync(files);
    // Make a fresh ArrayBuffer-backed copy so Blob doesn't hold a reference to
    // fflate's internal buffer (it might reuse it).
    const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folder}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSuccess(`Exported '${p.provider.manifest.name}' as ${folder}.zip`);
    setError(null);
  }

  function handleDelete(id: string, name: string) {
    // Stage the delete; the confirm dialog below resolves it.
    setPendingDelete({ id, name });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    removeCustomProvider(pendingDelete.id);
    onDeleted(pendingDelete.id);
    setSuccess(`Deleted '${pendingDelete.name}'`);
    setError(null);
    setPendingDelete(null);
    // If the user was editing the one they just deleted, drop edit state so
    // the editor returns to the empty "add new" view.
    if (editingId === pendingDelete.id) startNew();
  }

  function cancelDelete() {
    setPendingDelete(null);
  }

  return (
    <div className="custom-modal-overlay" onClick={onClose}>
      <div
        className="custom-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-modal-title"
      >
        <header className="custom-modal-header">
          <h2 id="custom-modal-title">Custom providers</h2>
          <button
            className="custom-modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="custom-modal-body">
          <p className="custom-modal-intro">
            Add field maps for your own APIs. YAML is stored in your browser's
            localStorage — never uploaded anywhere. Same schema as the built-in{" "}
            <code>providers/</code> directory; see{" "}
            <a
              href="https://github.com/javadogwebdesign/doppelforge/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              CONTRIBUTING.md
            </a>
            .
          </p>

          {customProviders.length > 0 && (
            <section className="custom-modal-section">
              <h3>Existing custom providers</h3>
              <ul className="custom-provider-list">
                {customProviders.map((p) => {
                  const isEditing = editingId === p.provider.manifest.id;
                  return (
                    <li
                      key={p.provider.manifest.id}
                      className={`custom-provider-row${isEditing ? " editing" : ""}`}
                    >
                      <div className="custom-provider-meta">
                        <strong>
                          {p.provider.manifest.name}
                          {isEditing && (
                            <span className="custom-editing-badge" title="Loaded in the editor below">
                              <Pencil size={11} />
                              editing
                            </span>
                          )}
                        </strong>
                        <span className="custom-provider-id">
                          {p.provider.manifest.id} · {p.provider.endpoints.length} endpoint
                          {p.provider.endpoints.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="custom-provider-actions">
                        <button
                          onClick={() => loadExisting(p)}
                          title="Load this provider's YAML into the editor below"
                          className={isEditing ? "active" : ""}
                          disabled={isEditing}
                        >
                          {isEditing ? "Loaded" : "Edit"}
                        </button>
                        <button
                          onClick={() => exportAsZip(p)}
                          title="Download as a zip you can share or upstream as a PR"
                        >
                          <Download size={14} />
                          <span>Export</span>
                        </button>
                        <button
                          onClick={() =>
                            handleDelete(p.provider.manifest.id, p.provider.manifest.name)
                          }
                          title="Delete provider"
                          className="danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="custom-modal-section" ref={editorRef}>
            {editingProvider && (
              <div className="custom-editing-banner" role="status">
                <span className="custom-editing-pill">
                  <Pencil size={11} aria-hidden="true" />
                  EDITING
                </span>
                <span className="custom-editing-banner-name">
                  {editingProvider.provider.manifest.name}
                </span>
                <span className="custom-editing-banner-id">
                  {editingProvider.provider.manifest.id}
                </span>
                <button
                  type="button"
                  className="custom-editing-banner-cancel"
                  onClick={startNew}
                  title="Discard changes and start a fresh new provider"
                >
                  Add new instead
                </button>
              </div>
            )}
            <div className="custom-section-header">
              <h3>
                {editingProvider
                  ? `Editing: ${editingProvider.provider.manifest.name}`
                  : "Add a new provider"}
              </h3>
              <div className="custom-section-actions">
                <label
                  className="custom-upload-btn"
                  title={
                    "Select one or more .yaml/.yml files, OR a .zip exported from another doppelforge user.\n\n" +
                    "Filename rules:\n" +
                    "  • manifest.yaml / manifest.yml → becomes the provider manifest\n" +
                    "  • everything else → becomes an endpoint with slug = filename (without extension)\n\n" +
                    "Example: users-retrieve.yaml → endpoint slug 'users-retrieve'"
                  }
                >
                  <Upload size={14} />
                  <span>Upload files / zip</span>
                  <input
                    type="file"
                    accept=".yaml,.yml,.zip,text/yaml,application/yaml,application/zip"
                    multiple
                    onChange={(e) => {
                      handleFileUpload(e.target.files);
                      // Reset so the same file can be re-uploaded after edits
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>
                <button onClick={loadSample} title="Load a template to edit">
                  Load template
                </button>
                {hasContent && (
                  <button onClick={clearForm} title="Clear the form">
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="custom-upload-hint" role="note">
              <Info size={12} aria-hidden="true" />
              <span>
                <strong>Upload accepts</strong> multi-selected <code>.yaml</code>/<code>.yml</code>{" "}
                files or a <code>.zip</code> from another user. Files named{" "}
                <code>manifest.yaml</code> become the provider manifest; all others become endpoints
                with slug = filename without extension. The <strong>Export</strong> button on existing
                providers above produces a compatible zip.
              </span>
            </div>

            <label className="custom-field-label" htmlFor="custom-manifest">
              manifest.yaml
            </label>
            <YamlEditor
              value={manifestYaml}
              onChange={setManifestYaml}
              placeholder={SAMPLE_MANIFEST}
              minHeight="150px"
              ariaLabel="Provider manifest YAML"
            />
            <p className="custom-manifest-hint">
              <Info size={11} aria-hidden="true" />
              <span>
                <strong>Icons:</strong>{" "}
                <code>shopping-bag</code>, <code>credit-card</code>, <code>users</code>,{" "}
                <code>database</code>, <code>cloud</code>, <code>mail</code>,{" "}
                <code>shield-check</code>, <code>life-buoy</code>, <code>megaphone</code>,{" "}
                <code>truck</code>, <code>wallet</code>, <code>square</code>,{" "}
                <code>phone</code>, <code>repeat</code>, <code>layers</code>{" "}
                (and more — see{" "}
                <a
                  href="https://lucide.dev/icons"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  lucide.dev/icons
                </a>
                ). Unknown names fall back to a generic <code>layers</code> icon.{" "}
                <strong>Color:</strong> any hex (e.g. <code>"#6366F1"</code>) — used to
                tint the sidebar's active-row accent.
              </span>
            </p>

            <label className="custom-field-label">endpoints</label>
            {endpoints.map((row, i) => (
              <div className="custom-endpoint-row" key={i}>
                <input
                  className="custom-endpoint-slug"
                  type="text"
                  placeholder="endpoint-slug (e.g. users-retrieve)"
                  value={row.slug}
                  onChange={(e) => updateEndpoint(i, { slug: e.target.value })}
                />
                <YamlEditor
                  value={row.yaml}
                  onChange={(next) => updateEndpoint(i, { yaml: next })}
                  placeholder={SAMPLE_ENDPOINT}
                  minHeight="220px"
                  ariaLabel={`Endpoint YAML for ${row.slug || "(unnamed)"}`}
                />
                <button
                  className="custom-endpoint-remove"
                  onClick={() => removeEndpointRow(i)}
                  title="Remove this endpoint"
                  aria-label="Remove endpoint"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button className="custom-add-endpoint" onClick={addEndpointRow}>
              <Plus size={14} />
              <span>Add another endpoint</span>
            </button>
          </section>

          {error && <div className="custom-modal-error">{error}</div>}
          {success && <div className="custom-modal-success">{success}</div>}
        </div>

        <footer className="custom-modal-footer">
          <button onClick={onClose} title="Close without saving">
            Cancel
          </button>
          <button onClick={handleSave} className="primary" disabled={!hasContent}>
            {editingProvider
              ? `Save changes to '${editingProvider.provider.manifest.name}'`
              : "Save new provider"}
          </button>
        </footer>
      </div>

      {pendingDelete && (
        <div
          className="confirm-modal-overlay"
          onClick={cancelDelete}
          role="presentation"
        >
          <div
            className="confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-desc"
          >
            <h3 id="confirm-delete-title">Delete custom provider?</h3>
            <p id="confirm-delete-desc">
              <strong>{pendingDelete.name}</strong> will be removed from your
              browser's localStorage. Its YAML, signature, and field map are
              not stored anywhere else — this can't be undone.
            </p>
            <p className="confirm-modal-hint">
              Tip: export it as a <code>.zip</code> first if you want to keep
              a copy.
            </p>
            <div className="confirm-modal-actions">
              <button
                ref={confirmCancelRef}
                onClick={cancelDelete}
                title="Keep the provider"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="danger"
                title="Permanently delete this custom provider"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
