import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16, padding: 32, fontFamily: 'sans-serif',
          background: '#f6f7f9', color: '#374257',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#fee2e2',
            display: 'grid', placeItems: 'center', fontSize: 24,
          }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Что-то пошло не так</h2>
          <p style={{ margin: 0, color: '#8693a8', fontSize: 14, textAlign: 'center', maxWidth: 400 }}>
            {this.state.error?.message || 'Неизвестная ошибка'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '10px 20px', borderRadius: 10, border: 'none',
              background: '#2167e2', color: 'white', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            На главную
          </button>
          {import.meta.env.DEV && (
            <pre style={{
              marginTop: 16, padding: 16, background: '#fff', borderRadius: 8,
              border: '1px solid #e2e6ef', fontSize: 11, maxWidth: '100%',
              overflow: 'auto', color: '#374257',
            }}>
              {this.state.error?.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
