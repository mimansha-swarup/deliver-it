import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * Catches a crash anywhere below it and shows a message instead of a blank
 * page. React only offers this for class components, so it's the one class here.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="title-screen">
        <div className="title-card">
          <h1>Something went wrong</h1>
          <p className="title-subtitle">The neighbourhood couldn't be loaded.</p>
          <button type="button" autoFocus onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    )
  }
}
