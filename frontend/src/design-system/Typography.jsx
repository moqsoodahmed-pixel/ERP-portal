import React from 'react';

export function Display({ children, className = '', as: Component = 'h1', ...props }) {
  return <Component className={`font-display ${className}`} {...props}>{children}</Component>;
}

export function H1({ children, className = '', as: Component = 'h1', ...props }) {
  return <Component className={`font-h1 ${className}`} {...props}>{children}</Component>;
}

export function H2({ children, className = '', as: Component = 'h2', ...props }) {
  return <Component className={`font-h2 ${className}`} {...props}>{children}</Component>;
}

export function H3({ children, className = '', as: Component = 'h3', ...props }) {
  return <Component className={`font-h3 ${className}`} {...props}>{children}</Component>;
}

export function H4({ children, className = '', as: Component = 'h4', ...props }) {
  return <Component className={`font-h4 ${className}`} {...props}>{children}</Component>;
}

export function Title({ children, className = '', as: Component = 'p', ...props }) {
  return <Component className={`font-title ${className}`} {...props}>{children}</Component>;
}

export function Subtitle({ children, className = '', as: Component = 'p', ...props }) {
  return <Component className={`font-subtitle ${className}`} {...props}>{children}</Component>;
}

export function BodyLarge({ children, className = '', as: Component = 'p', ...props }) {
  return <Component className={`font-body-lg ${className}`} {...props}>{children}</Component>;
}

export function Body({ children, className = '', as: Component = 'p', ...props }) {
  return <Component className={`font-body ${className}`} {...props}>{children}</Component>;
}

export function BodySmall({ children, className = '', as: Component = 'p', ...props }) {
  return <Component className={`font-body-sm ${className}`} {...props}>{children}</Component>;
}

export function Caption({ children, className = '', as: Component = 'span', ...props }) {
  return <Component className={`font-caption ${className}`} {...props}>{children}</Component>;
}

export function Label({ children, className = '', as: Component = 'span', ...props }) {
  return <Component className={`font-label ${className}`} {...props}>{children}</Component>;
}

export default {
  Display,
  H1,
  H2,
  H3,
  H4,
  Title,
  Subtitle,
  BodyLarge,
  Body,
  BodySmall,
  Caption,
  Label,
};
