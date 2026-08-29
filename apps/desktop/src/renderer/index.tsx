import React, { Component, ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Uncaught UI error:", error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px", color: "#e0e0e0", fontFamily: "system-ui, sans-serif", background: "#121212", height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <h2 style={{ color: "#f14c4c", margin: "0 0 12px" }}>Something went wrong in the UI</h2>
          <pre style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", padding: "16px", borderRadius: "8px", overflow: "auto", fontSize: "12px", color: "#a0a0a0", maxWidth: "600px", textAlign: "left" }}>
            {this.state.error?.message}
          </pre>
          <button
            style={{ marginTop: "20px", padding: "8px 18px", background: "#0e639c", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}
            onClick={() => window.location.reload()}
          >
            Reload Window
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}