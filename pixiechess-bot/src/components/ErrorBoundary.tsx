import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-8">
          <div className="max-w-md bg-gray-800 rounded-lg p-6 border border-red-500/30 shadow-2xl">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Engine Desync</h2>
            <p className="text-gray-300 mb-4">
              The Pixie Engine encountered a critical state error and crashed.
            </p>
            <div className="bg-black/50 p-3 rounded font-mono text-sm text-red-300 mb-6 overflow-auto max-h-32">
              {this.state.error?.message}
            </div>
            <button
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded transition-colors"
              onClick={() => window.location.reload()}
            >
              Restart Engine
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
