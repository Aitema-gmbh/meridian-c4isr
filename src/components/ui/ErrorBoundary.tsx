import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-4 bg-background">
          <div className="text-[10px] font-mono text-crimson uppercase tracking-wider">
            {this.props.fallbackLabel || "MODULE"} OFFLINE
          </div>
          <div className="text-[9px] font-mono text-muted-foreground max-w-[200px] text-center truncate">
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={this.handleRetry}
            className="text-[9px] font-mono px-3 py-1 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-colors"
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
