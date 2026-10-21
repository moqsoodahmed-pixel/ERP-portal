import React from 'react';
import {
  LoadingState as LDSLoadingState,
  ErrorState as LDSErrorState,
  EmptyState as LDSEmptyState,
} from '../design-system/index.js';

export function LoadingState(props) {
  return <LDSLoadingState {...props} />;
}

export function ErrorState(props) {
  return <LDSErrorState {...props} />;
}

export function EmptyState(props) {
  return <LDSEmptyState {...props} />;
}

export default {
  LoadingState,
  ErrorState,
  EmptyState,
};
