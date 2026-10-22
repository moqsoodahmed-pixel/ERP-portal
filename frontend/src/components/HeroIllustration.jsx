import React from 'react';

/**
 * Ultimate Luxury Executive Workspace Hero Composition matching the reference design.
 * The dashboard background canvas provides the full-bleed office scene and flowing silk ribbons.
 * HeroIllustration adds ambient volumetric light bloom, floating particles, and soft bokeh.
 */
export default function HeroIllustration({ className = '' }) {
  return (
    <div className={`hero-illustration-wrapper ${className}`.trim()} aria-hidden="true">
      {/* Ambient Lighting & Volumetric Bloom Over the Merged Background */}
      <div className="hero-ambient-glow" />
      <div className="hero-volumetric-haze" />

      {/* Layer 6: Very Soft Light Particles, Tiny Golden Dust & Subtle Bokeh */}
      <svg
        className="hero-layer-particles-svg"
        viewBox="0 0 1440 340"
        fill="none"
        preserveAspectRatio="none"
      >
        <defs>
          <filter id="mote-glow-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id="mote-glow-core" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
          <radialGradient id="bokeh-orb-1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#C084FC" stopOpacity="0.18" />
            <stop offset="60%" stopColor="#DDD6FE" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="bokeh-orb-2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FDBA74" stopOpacity="0.20" />
            <stop offset="60%" stopColor="#FED7AA" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient Bokeh Orbs */}
        <circle cx="180" cy="90" r="45" fill="url(#bokeh-orb-1)" />
        <circle cx="360" cy="220" r="55" fill="url(#bokeh-orb-2)" />
        <circle cx="680" cy="75" r="40" fill="url(#bokeh-orb-1)" />
        <circle cx="920" cy="180" r="35" fill="url(#bokeh-orb-2)" />

        {/* Floating Light Specks & Tiny Golden Dust */}
        <g opacity="0.80">
          <circle cx="140" cy="130" r="2.0" fill="#FEF08A" filter="url(#mote-glow-soft)" />
          <circle cx="230" cy="70" r="1.6" fill="#FDE68A" />
          <circle cx="310" cy="180" r="2.2" fill="#FFFFFF" filter="url(#mote-glow-core)" />
          <circle cx="420" cy="110" r="1.7" fill="#FED7AA" />
          <circle cx="510" cy="210" r="2.0" fill="#FBCFE8" />
          <circle cx="620" cy="80" r="2.4" fill="#FEF08A" filter="url(#mote-glow-soft)" />
          <circle cx="710" cy="160" r="1.8" fill="#DDD6FE" />
          <circle cx="800" cy="65" r="2.2" fill="#FFFFFF" filter="url(#mote-glow-core)" />
          <circle cx="890" cy="195" r="1.9" fill="#FED7AA" />
          <circle cx="980" cy="115" r="2.2" fill="#FEF08A" filter="url(#mote-glow-soft)" />
          <circle cx="1060" cy="75" r="1.6" fill="#FBCFE8" />
          <circle cx="1150" cy="170" r="2.0" fill="#FFFFFF" filter="url(#mote-glow-core)" />
          <circle cx="1260" cy="105" r="2.2" fill="#FED7AA" />
          <circle cx="1350" cy="150" r="1.8" fill="#FEF08A" filter="url(#mote-glow-soft)" />
        </g>
      </svg>
    </div>
  );
}
