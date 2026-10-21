import React from 'react';

/**
 * Premium Luxury Office Workspace Illustration matching reference image.
 * Renders the photorealistic 3D workspace scene with a seamless left-edge gradient mask
 * and floating luminous light ribbons.
 */
export default function HeroIllustration({ className = '' }) {
  return (
    <div className={`hero-illustration-wrapper ${className}`.trim()} aria-hidden="true">
      <img
        src="/brand/hero_workspace.jpg"
        alt=""
        className="hero-illustration-img"
        loading="eager"
      />
      {/* 3D flowing luminous ambient light ribbons overlay */}
      <svg className="hero-illustration-ribbon" viewBox="0 0 520 280" fill="none" preserveAspectRatio="none">
        <path
          d="M -40,130 C 70,50 170,190 290,110 C 390,40 460,80 540,60"
          stroke="url(#hero-ribbon-grad1)"
          strokeWidth="28"
          strokeLinecap="round"
          opacity="0.3"
          filter="blur(8px)"
        />
        <path
          d="M -40,130 C 70,50 170,190 290,110 C 390,40 460,80 540,60"
          stroke="url(#hero-ribbon-grad2)"
          strokeWidth="12"
          strokeLinecap="round"
          opacity="0.75"
        />
        <defs>
          <linearGradient id="hero-ribbon-grad1" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#C084FC" />
            <stop offset="50%" stopColor="#F472B6" />
            <stop offset="100%" stopColor="#FDBA74" />
          </linearGradient>
          <linearGradient id="hero-ribbon-grad2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#E9D5FF" />
            <stop offset="60%" stopColor="#FBCFE8" />
            <stop offset="100%" stopColor="#FED7AA" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

