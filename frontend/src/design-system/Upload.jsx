import React, { useRef, useState } from 'react';

/**
 * LDS v1.0 UploadDropzone Component
 * Staged file selection with drag-and-drop support.
 */
export function UploadDropzone({
  onFileSelect,
  accept = '.pdf,.png,.jpg,.jpeg',
  maxSizeMb = 10,
  label = 'Drag and drop file here, or browse',
  hint = 'Supports PDF, PNG, JPG up to 10MB',
  className = '',
  disabled = false,
  onError,
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef(null);

  const acceptFile = (file) => {
    if (file.size > maxSizeMb * 1024 * 1024) {
      onError?.(`${file.name} is larger than ${maxSizeMb}MB`);
      return;
    }
    onFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      acceptFile(files[0]);
    }
  };

  const handleChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      acceptFile(files[0]);
    }
  };

  return (
    <div
      className={`lds-dropzone ${isDragOver ? 'is-drag-over' : ''} ${className}`.trim()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragOver ? 'var(--primary)' : 'var(--line-default)'}`,
        borderRadius: 'var(--radius-md)',
        background: isDragOver ? 'var(--primary-subtle)' : 'var(--bg-app)',
        padding: '2rem 1.5rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--trans-fast)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled}
      />
      <div style={{ fontSize: '28px', marginBottom: '0.5rem', color: 'var(--primary)' }}>📁</div>
      <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--ink-primary)' }}>{label}</div>
      {hint && <div className="muted" style={{ fontSize: '12px', marginTop: '0.25rem' }}>{hint}</div>}
    </div>
  );
}

/**
 * LDS v1.0 FilePreview Component
 */
export function FilePreview({ file, onRemove, className = '' }) {
  if (!file) return null;

  const sizeKb = (file.size / 1024).toFixed(1);

  return (
    <div
      className={`lds-file-preview card ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        border: '1px solid var(--line-default)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-card)',
        marginTop: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '20px' }}>📄</span>
        <div>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink-primary)' }}>{file.name}</div>
          <div className="muted" style={{ fontSize: '12px' }}>{sizeKb} KB · Ready for upload</div>
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={onRemove}
          style={{ color: 'var(--bad)' }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

export default {
  UploadDropzone,
  FilePreview,
};
