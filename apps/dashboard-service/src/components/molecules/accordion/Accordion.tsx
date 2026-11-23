import React, { useState } from 'react';
import { AccordionButton } from '../../atoms/accordion-button/AccordionButton';
import { AccordionContent } from '../../atoms/accordion-content/AccordionContent';
import { ChartBar } from '@/components/atoms/icon/icons';

interface AccordionProps {
  name: string;
  children: React.ReactNode;
  icon: any;
}

export const Accordion: React.FC<AccordionProps> = ({ name, children, icon }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <li>
      <AccordionButton 
        name={name} 
        icon={icon} 
        isExpanded={isExpanded} 
        onToggle={handleToggle} 
      />
      {isExpanded && <AccordionContent>{children}</AccordionContent>}
    </li>
  );
};
