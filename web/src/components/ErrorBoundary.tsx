import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Top-level safety net. Any render-phase exception in the tree below this
// (e.g. a transform engine throw that bubbles out of useObfuscator, or a
// malformed payload that escapes the parsers) lands here instead of
// white-screening the tab. The user keeps anything they'd already saved to
// history; the live in-progress paste is lost (React state goes with the
// crash).
//
// Class component because hooks can't catch render errors - this is one of
// the rare cases where the class API is the only API.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to the console only - no off-origin reporting, no telemetry.
    // The CSP would block any sneaky beacon anyway, but this keeps the
    // privacy claim "browser-only" honest at the source level.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="error-boundary">
          <div className="error-boundary-card">
            <h2>Something went wrong</h2>
            <p>
              The app hit an unrecoverable error. Your current paste is gone,
              but anything previously saved to <strong>History</strong> is
              still in your browser.
            </p>
            <p className="error-boundary-detail">
              <code>{this.state.error.message || "Unknown error"}</code>
            </p>
            <button onClick={this.handleReload} className="error-boundary-reload">
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
