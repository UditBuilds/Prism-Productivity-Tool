"use client";

import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Class-based error boundary (React has no hook equivalent). Catches render
 * errors in its subtree and shows a retry card instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-danger/10">
              <AlertCircle className="h-6 w-6 text-danger" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              Something went wrong
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {this.state.error?.message ?? "An unexpected error occurred"}
            </p>
            <Button
              variant="outline"
              className="mt-4 rounded-lg"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
            </Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
