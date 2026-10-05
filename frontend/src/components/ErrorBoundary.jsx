import { Component } from 'react';
import ErrorPage from '../pages/ErrorPage.jsx';

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <ErrorPage /> : this.props.children; }
}
