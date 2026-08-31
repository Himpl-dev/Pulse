import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { TOKENS } from '../theme';

// React error boundaries have to be class components — no hook equivalent
// exists. Wrap anything that touches genuinely unpredictable browser APIs
// (camera streams, speech recognition, etc.) in this so a crash there shows
// a scoped "try again" instead of blanking the whole app, which otherwise
// happens by default when an uncaught error reaches React during render.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Caught by ErrorBoundary', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl p-6 text-center max-w-md" style={{ background: TOKENS.surface, border: `1px dashed ${TOKENS.border}` }}>
          <AlertTriangle size={20} style={{ color: TOKENS.coral, margin: '0 auto 8px', display: 'block' }} />
          <p className="text-sm mb-3" style={{ color: TOKENS.text }}>Something went wrong here.</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: TOKENS.blue, color: '#0B0D11' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
