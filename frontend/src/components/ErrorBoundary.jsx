import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    const errorId = Date.now().toString(36).toUpperCase();
    this.setState({ errorId });
    console.error('[ErrorBoundary]', { errorId, error, componentStack: info.componentStack });
    // Hook point: const sentryId = Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    //             this.setState({ errorId: sentryId });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000', color: '#fff', flexDirection: 'column', gap: '16px', padding: '24px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px' }}>😵</div>
        <div style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>Something went wrong</div>
        <div style={{ fontSize: '13px', color: '#888', maxWidth: '400px', lineHeight: '1.6' }}>
          {this.state.error?.message || 'An unexpected error occurred.'}
        </div>
        {this.state.errorId && (
          <div style={{ fontSize: '11px', color: '#444', fontFamily: 'monospace', letterSpacing: '0.5px' }}>
            Error ID: {this.state.errorId}
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px', background: '#D4FF32', color: '#000', border: 'none',
            borderRadius: '12px', padding: '12px 28px', fontSize: '14px', fontWeight: '800', cursor: 'pointer',
          }}
        >
          Reload app
        </button>
      </div>
    );
  }
}
