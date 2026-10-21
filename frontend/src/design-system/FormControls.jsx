import React, { useState, useRef } from 'react';

/**
 * LDS v1.0 FormField Component
 * Label, required indicator, hint, and error container.
 */
export function FormField({
  label,
  required = false,
  hint,
  error,
  children,
  inline = false,
  className = '',
  id,
}) {
  return (
    <div className={`field ${inline ? 'field--inline' : ''} ${className}`.trim()}>
      {label && (
        <label htmlFor={id} className="field__label">
          {label} {required && <span className="field__required" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="muted field__hint" style={{ fontSize: '12px' }}>{hint}</span>}
      {error && <span className="field__error" role="alert" style={{ fontSize: '12px', color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}

/**
 * LDS v1.0 TextInput Component
 */
export function TextInput({
  id,
  type = 'text',
  value,
  defaultValue,
  placeholder,
  disabled = false,
  readOnly = false,
  required = false,
  startIcon,
  endIcon,
  className = '',
  onChange,
  ...props
}) {
  return (
    <div className={`input-wrapper ${startIcon ? 'has-start-icon' : ''} ${endIcon ? 'has-end-icon' : ''}`}>
      {startIcon && <span className="input-icon input-icon--start">{startIcon}</span>}
      <input
        id={id}
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        className={`input ${className}`.trim()}
        onChange={onChange}
        {...props}
      />
      {endIcon && <span className="input-icon input-icon--end">{endIcon}</span>}
    </div>
  );
}

/**
 * LDS v1.0 PasswordInput Component
 * Password input with show/hide toggle.
 */
export function PasswordInput({ id, placeholder = '••••••••', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrapper has-end-icon" style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        className="input"
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: 'var(--ink-muted)',
          fontSize: '12px',
        }}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

/**
 * LDS v1.0 PhoneInput Component
 */
export function PhoneInput({ countryCode = '+91', ...props }) {
  return (
    <div className="input-group" style={{ display: 'flex', gap: '4px' }}>
      <span className="btn" style={{ padding: '0.45rem 0.65rem', background: 'var(--bg-app)', border: '1px solid var(--line-default)', color: 'var(--ink-muted)' }}>
        {countryCode}
      </span>
      <input type="tel" className="input" {...props} />
    </div>
  );
}

/**
 * LDS v1.0 SearchBox Component
 */
export function SearchBox({
  value,
  defaultValue,
  placeholder = 'Search…',
  onChange,
  className = '',
  ...props
}) {
  return (
    <div className={`search-box ${className}`.trim()} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: '100%' }}>
      <input
        type="search"
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={onChange}
        className="input search-box__input"
        style={{ width: '100%' }}
        {...props}
      />
    </div>
  );
}

/**
 * LDS v1.0 Select Component
 */
export function Select({
  id,
  value,
  defaultValue,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  onChange,
  className = '',
  children,
  ...props
}) {
  return (
    <select
      id={id}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange}
      className={`select ${className}`.trim()}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.length > 0
        ? options.map((opt) => {
            const val = typeof opt === 'object' ? opt.value : opt;
            const lbl = typeof opt === 'object' ? opt.label : opt;
            return <option key={val} value={val}>{lbl}</option>;
          })
        : children}
    </select>
  );
}

/**
 * LDS v1.0 Checkbox Component
 */
export function Checkbox({
  id,
  checked,
  defaultChecked,
  label,
  disabled = false,
  onChange,
  className = '',
  ...props
}) {
  return (
    <label className={`checkbox-label ${className}`.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onChange}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * LDS v1.0 Radio Component
 */
export function Radio({
  id,
  name,
  value,
  checked,
  defaultChecked,
  label,
  disabled = false,
  onChange,
  className = '',
  ...props
}) {
  return (
    <label className={`radio-label ${className}`.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onChange}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * LDS v1.0 Toggle Component
 */
export function Toggle({
  id,
  checked,
  defaultChecked,
  label,
  disabled = false,
  onChange,
  className = '',
  ...props
}) {
  return (
    <label className={`lds-toggle ${className}`.trim()}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={onChange}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        {...props}
      />
      <span className="lds-toggle-switch" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * LDS v1.0 Textarea Component
 */
export function Textarea({
  id,
  value,
  defaultValue,
  placeholder,
  rows = 3,
  disabled = false,
  onChange,
  className = '',
  ...props
}) {
  return (
    <textarea
      id={id}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      onChange={onChange}
      className={`textarea ${className}`.trim()}
      {...props}
    />
  );
}

/**
 * LDS v1.0 OtpInput Component
 */
export function OtpInput({ length = 6, value = '', onChange }) {
  const inputsRef = useRef([]);

  const handleChange = (e, index) => {
    const val = e.target.value.slice(-1);
    const chars = value.split('');
    chars[index] = val;
    const nextVal = chars.join('');
    onChange(nextVal);
    if (val && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  return (
    <div className="lds-otp-container">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          className="lds-otp-slot"
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}

export default {
  FormField,
  TextInput,
  PasswordInput,
  PhoneInput,
  SearchBox,
  Select,
  Checkbox,
  Radio,
  Toggle,
  Textarea,
  OtpInput,
};
