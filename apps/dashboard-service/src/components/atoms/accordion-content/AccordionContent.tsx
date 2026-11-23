import React from 'react';

interface AccordionContentProps {
  children: React.ReactNode;
}

export const AccordionContent: React.FC<AccordionContentProps> = ({ children }) => {
  return (
    <div className="w-full overflow-hidden transition-[height] duration-300">
      <ul className="ps-8 pt-1 space-y-1">
        {children}
      </ul>
    </div>
  );
};
