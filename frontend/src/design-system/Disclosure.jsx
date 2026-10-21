import React, { useState, useRef, useEffect } from 'react';

/**
 * LDS v1.0 Accordion Component
 */
export function Accordion({ children, allowMultiple = false, className = '' }) {
  const [openIndices, setOpenIndices] = useState([0]);

  const toggle = (idx) => {
    if (allowMultiple) {
      setOpenIndices((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    } else {
      setOpenIndices((prev) => (prev.includes(idx) ? [] : [idx]));
    }
  };

  return (
    <div className={`lds-accordion ${className}`.trim()}>
      {React.Children.map(children, (child, idx) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child, {
          isOpen: openIndices.includes(idx),
          onToggle: () => toggle(idx),
        });
      })}
    </div>
  );
}

export function AccordionItem({ title, children, isOpen, onToggle, className = '' }) {
  return (
    <div className={`lds-accordion-item ${isOpen ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="lds-accordion-header"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <span
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
            fontSize: 12,
          }}
        >
          ▼
        </span>
      </button>
      {isOpen && <div className="lds-accordion-content">{children}</div>}
    </div>
  );
}

/**
 * LDS v1.0 Dropdown Component
 */
export function Dropdown({
  trigger,
  children,
  align = 'left', // 'left' | 'right'
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={`lds-dropdown-container ${className}`.trim()}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <div onClick={() => setOpen(!open)} role="button" tabIndex={0}>
        {trigger}
      </div>
      {open && (
        <div
          className="lds-dropdown-menu card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align]: 0,
            minWidth: 180,
            zIndex: 100,
            padding: '0.4rem',
            boxShadow: 'var(--elevation-2)',
            borderRadius: 'var(--radius-md)',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ children, onClick, danger = false, disabled = false, className = '' }) {
  return (
    <div
      className={`lds-dropdown-item ${danger ? 'text-danger' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--radius-xs)',
        fontSize: '13.5px',
        fontWeight: 500,
        color: danger ? 'var(--bad)' : 'var(--ink-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = danger ? 'var(--bad-bg)' : 'var(--bg-app)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </div>
  );
}

export default {
  Accordion,
  AccordionItem,
  Dropdown,
  DropdownItem,
};
