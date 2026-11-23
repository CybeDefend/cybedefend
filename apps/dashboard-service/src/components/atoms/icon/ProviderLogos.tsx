import React from 'react';

// A simple logo component; style it as needed.
const Logo: React.FC<{ name: string }> = ({ name }) => (
    <div className="w-8 h-8 flex items-center justify-center mr-3">
        <img src={`/logos/${name}.svg`} alt={`${name} logo`} className="max-w-full max-h-full" />
    </div>
);
// NOTE: the matching SVG files (docker.svg, gitlab.svg, etc.) live
// in `/public/logos/` (for instance from simpleicons.org).

export default Logo;